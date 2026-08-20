import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Square } from 'lucide-react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { Button } from '@/components/ui/button';
import { logger } from '@/utils/logger';

interface LaunchButtonProps {
	onLaunch: () => Promise<void>;
	disabled?: boolean;
	className?: string;
	isJavaInstalling?: boolean;
	instanceId?: string;
}

type LaunchState = 'idle' | 'launching' | 'playing';

// Global cache for launch states per instance
const launchStateCache = new Map<string, { state: LaunchState; startTime: number }>();

const LaunchButton: React.FC<LaunchButtonProps> = ({
	onLaunch,
	disabled = false,
	className = '',
	isJavaInstalling = false,
	instanceId = 'default'
}) => {
	const { t } = useTranslation('instance');

	// Initialize with cached state if it exists
	const getInitialState = () => {
		const cachedState = launchStateCache.get(instanceId);
		return cachedState?.state || 'idle';
	};
	
	const [state, setState] = useState<LaunchState>(getInitialState());
	const [playTime, setPlayTime] = useState(0);
	const startTimeRef = useRef<number>(Date.now());
	const [isHovered, setIsHovered] = useState(false);
	
	// Update state when instanceId changes
	useEffect(() => {
		const cachedState = launchStateCache.get(instanceId);
		if (cachedState) {
			setState(cachedState.state);
			if (cachedState.state === 'playing' || cachedState.state === 'launching') {
				startTimeRef.current = cachedState.startTime;
				// Calculate elapsed time
				const elapsed = Math.floor((Date.now() - cachedState.startTime) / 1000);
				setPlayTime(elapsed);
			} else {
				setPlayTime(0);
				startTimeRef.current = Date.now();
			}
		} else {
			setState('idle');
			setPlayTime(0);
			startTimeRef.current = Date.now();
		}
	}, [instanceId]);

	// Interval to increment the time while playing or launching
	useEffect(() => {
		let interval: ReturnType<typeof setInterval> | null = null;
		
		const updateTime = () => {
			const cached = launchStateCache.get(instanceId);
			if (cached && (cached.state === 'playing' || cached.state === 'launching')) {
				const elapsed = Math.floor((Date.now() - cached.startTime) / 1000);
					setPlayTime(elapsed);
			} else {
				setPlayTime(0);
				}
		};
		
		const cachedState = launchStateCache.get(instanceId);
		const currentState = cachedState?.state || state;
		
		if (currentState === 'playing' || currentState === 'launching') {
			updateTime();
			interval = setInterval(updateTime, 1000);
		} else {
			setPlayTime(0);
		}
		
		return () => { if (interval) clearInterval(interval); };
	}, [state, instanceId]);

	// Reset when the Minecraft process exits (only for this instance)
	useEffect(() => {
		let unlisten: (() => void) | undefined;
		listen('minecraft_exited', (event: any) => {
			const data = event.payload;
			// Only process if the event is for this instance
			if (data.instance_id !== instanceId) {
				return;
			}

			// Save total playtime before resetting
			const cached = launchStateCache.get(instanceId);
			if (cached && cached.state === 'playing') {
				const elapsed = Math.floor((Date.now() - cached.startTime) / 1000);
				const hours = elapsed / 3600;
				const saved = localStorage.getItem(`playtime_${instanceId}`);
				const previousHours = saved ? parseFloat(saved) || 0 : 0;
				const totalHours = previousHours + hours;
				localStorage.setItem(`playtime_${instanceId}`, totalHours.toString());
				window.dispatchEvent(new CustomEvent('playtime_updated', { detail: { instanceId } }));
			}
			
			setState('idle');
			setPlayTime(0);
			// Clear cache when the game exits
			launchStateCache.delete(instanceId);
			startTimeRef.current = Date.now();
		}).then((fn) => { unlisten = fn; }).catch(() => {});
		return () => { if (unlisten) { try { unlisten(); } catch {} } };
	}, [instanceId]);

	const handleClick = async () => {
		const currentCachedState = launchStateCache.get(instanceId);
		const currentState = currentCachedState?.state || state;
		
		if (disabled || currentState !== 'idle' || isJavaInstalling) {
			return;
		}
		
		setState('launching');
		const launchStartTime = Date.now();
		startTimeRef.current = launchStartTime;
		launchStateCache.set(instanceId, { state: 'launching', startTime: launchStartTime });
		setPlayTime(0);
		
		try {
			await onLaunch();
			const playStartTime = Date.now();
			startTimeRef.current = playStartTime;
			setState('playing');
			setPlayTime(0);
			launchStateCache.set(instanceId, { state: 'playing', startTime: playStartTime });
			localStorage.setItem(`last_played_${instanceId}`, playStartTime.toString());
			window.dispatchEvent(new CustomEvent('last_played_updated', { detail: { instanceId } }));
		} catch (error) {
			void logger.error(`Error during launch for instance ${instanceId}`, error, 'LaunchButton');
			setState('idle');
			setPlayTime(0);
			launchStateCache.delete(instanceId);
		}
	};

	const handleStop = async (e: React.MouseEvent) => {
		e.stopPropagation();
		e.preventDefault();

		const cached = launchStateCache.get(instanceId);
		launchStateCache.delete(instanceId);
		setState('idle');
		setPlayTime(0);

		if (cached && cached.state === 'playing') {
			const elapsed = Math.floor((Date.now() - cached.startTime) / 1000);
			const hours = elapsed / 3600;
			const saved = localStorage.getItem(`playtime_${instanceId}`);
			const previousHours = saved ? parseFloat(saved) || 0 : 0;
			const totalHours = previousHours + hours;
			localStorage.setItem(`playtime_${instanceId}`, totalHours.toString());
			window.dispatchEvent(new CustomEvent('playtime_updated', { detail: { instanceId } }));
		}

		try {
			await invoke('stop_minecraft_instance', { instanceId: instanceId });
		} catch (error) {
			void logger.error('Error stopping Minecraft', error, 'LaunchButton');
		}
	};

	const formatTime = (seconds: number): string => {
		const hours = Math.floor(seconds / 3600);
		const minutes = Math.floor((seconds % 3600) / 60);
		const secs = seconds % 60;
		if (hours > 0) return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
		return `${minutes}:${secs.toString().padStart(2, '0')}`;
	};

	const formatTimeForMarquee = (seconds: number): string => {
		const timeStr = formatTime(seconds);
		return timeStr.padEnd(10, ' ');
	};

	const getButtonContent = () => {
		switch (state) {
			case 'launching': {
				const timeText = formatTimeForMarquee(playTime);
				return (
					<div className="marquee-container">
						<div className="marquee-text">
							{timeText.split('').map((letter, index) => (
								<span
									key={index}
									className="marquee-letter"
									style={{
										animationDelay: `${(2.5 / timeText.length) * (timeText.length - 1 - index) * -1}s`
									}}
								>
									{letter === ' ' ? '\u00A0' : letter}
								</span>
							))}
						</div>
					</div>
				);
			}
			case 'playing': {
				const timeText = formatTimeForMarquee(playTime);
				return (
					<div className="marquee-container">
						<div className="marquee-text text-yellow-400">
							{timeText.split('').map((letter, index) => (
								<span
									key={index}
									className="marquee-letter"
									style={{
										animationDelay: `${(2.5 / timeText.length) * (timeText.length - 1 - index) * -1}s`
									}}
								>
									{letter === ' ' ? '\u00A0' : letter}
								</span>
							))}
						</div>
					</div>
				);
			}
			default:
				return t('play');
		}
	};

	const getButtonClass = () => {
		const baseClass = "text-white font-bold text-xl px-16 py-8 rounded-2xl shadow-2xl transform-gpu will-change-transform transition-[transform,box-shadow,border-color,background-color] duration-300 ease-out text-center relative overflow-hidden w-[16rem] hover:scale-[1.03]";
		const currentCachedState = launchStateCache.get(instanceId);
		const currentState = currentCachedState?.state || state;
		if (currentState === 'playing' || currentState === 'launching') {
			return `${baseClass} font-heading bg-gradient-to-r from-[#d4af37]/20 via-[#e0c15a]/20 to-[#d4af37]/20 hover:from-[#d4af37]/30 hover:via-[#e0c15a]/30 hover:to-[#d4af37]/30 neon-glow-cyan`;
		}
		return `${baseClass} font-heading bg-gradient-to-r from-[#d4af37]/10 via-[#7c4dbd]/10 to-[#d4af37]/10 hover:from-[#d4af37]/20 hover:via-[#7c4dbd]/20 hover:to-[#d4af37]/20 neon-glow-cyan-hover`;
	};

	const getButtonStyle = (isHovered: boolean = false) => {
		const currentCachedState = launchStateCache.get(instanceId);
		const currentState = currentCachedState?.state || state;
		if (currentState === 'playing' || currentState === 'launching') {
			return {
				background: 'rgba(0, 0, 0, 0.6)',
				backdropFilter: 'blur(24px)',
				WebkitBackdropFilter: 'blur(24px)',
				boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.7)',
				border: '1px solid',
				borderColor: isHovered ? 'rgba(212, 175, 55, 0.8)' : 'rgba(212, 175, 55, 0.5)',
			};
		}
		return {
			background: 'rgba(0, 0, 0, 0.6)',
			backdropFilter: 'blur(24px)',
			WebkitBackdropFilter: 'blur(24px)',
			boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.7)',
			border: '1px solid',
			borderColor: isHovered ? 'rgba(212, 175, 55, 0.7)' : 'rgba(212, 175, 55, 0.4)',
		};
	};

	const currentCachedState = launchStateCache.get(instanceId);
	const displayState = currentCachedState?.state || state;
	const isButtonDisabled = disabled || displayState !== 'idle' || isJavaInstalling;
	const showStopButton = displayState === 'playing' && isHovered && !isJavaInstalling;
	
	return (
		<div 
			className="relative"
			onMouseEnter={() => setIsHovered(true)}
			onMouseLeave={() => setIsHovered(false)}
			style={{ zIndex: 1 }}
		>
			<Button
				onClick={handleClick}
				disabled={isButtonDisabled}
				className={`${getButtonClass()} ${className}`}
				style={getButtonStyle(isHovered)}
			>
				{(displayState === 'launching' || displayState === 'playing') && (
					<div className="absolute inset-0 flex items-center justify-center">
						<div className="marquee-container transition-all duration-500">
							<div className={`marquee-text ${displayState === 'playing' ? 'text-yellow-400' : ''}`}>
								{formatTimeForMarquee(playTime).split('').map((letter, index) => (
									<span
										key={index}
										className={`marquee-letter transition-all duration-500 ${displayState === 'playing' ? 'text-yellow-400' : ''}`}
										style={{
											animationDelay: `${(2.5 / formatTimeForMarquee(playTime).length) * (formatTimeForMarquee(playTime).length - 1 - index) * -1}s`
										}}
									>
										{letter === ' ' ? '\u00A0' : letter}
									</span>
								))}
							</div>
						</div>
					</div>
				)}

				<span className="relative z-10">
					{displayState === 'launching' || displayState === 'playing' ? '' : getButtonContent()}
				</span>
			</Button>
			
			{showStopButton && (
				<div 
					className="absolute inset-0 z-50 flex items-center justify-center animate-fade-in pointer-events-none"
				>
					<div
						onClick={(e) => {
							e.stopPropagation();
							e.preventDefault();
							handleStop(e);
						}}
						onMouseDown={(e) => {
							e.stopPropagation();
						}}
						role="button"
						tabIndex={0}
						onKeyDown={(e) => {
							if (e.key === 'Enter' || e.key === ' ') {
								e.preventDefault();
								e.stopPropagation();
								handleStop(e as any);
							}
						}}
						className="w-14 h-14 rounded-full bg-red-600/90 hover:bg-red-700/90 border-2 border-red-400/50 flex items-center justify-center cursor-pointer transition-all duration-200 pointer-events-auto"
					>
						<Square className="w-6 h-6 text-white" fill="currentColor" />
					</div>
				</div>
			)}
			
			<style>{`
				@keyframes fade-in {
					from {
						opacity: 0;
						transform: scale(0.9);
					}
					to {
						opacity: 1;
						transform: scale(1);
					}
				}
				.animate-fade-in {
					animation: fade-in 0.2s ease-out;
				}
			`}</style>
		</div>
	);
};

export default LaunchButton;
