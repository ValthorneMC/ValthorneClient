import React, { useState, useEffect, useRef } from 'react';
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

// Caché global para estados de lanzamiento por instancia
const launchStateCache = new Map<string, { state: LaunchState; startTime: number }>();

const LaunchButton: React.FC<LaunchButtonProps> = ({
	onLaunch,
	disabled = false,
	className = '',
	isJavaInstalling = false,
	instanceId = 'default'
}) => {
	// Inicializar con estado en caché si existe
	const getInitialState = () => {
		const cachedState = launchStateCache.get(instanceId);
		return cachedState?.state || 'idle';
	};
	
	const [state, setState] = useState<LaunchState>(getInitialState());
	const [playTime, setPlayTime] = useState(0);
	const startTimeRef = useRef<number>(Date.now());
	const [isHovered, setIsHovered] = useState(false);
	
	// Actualizar estado cuando cambia instanceId
	useEffect(() => {
		const cachedState = launchStateCache.get(instanceId);
		if (cachedState) {
			setState(cachedState.state);
			if (cachedState.state === 'playing' || cachedState.state === 'launching') {
				startTimeRef.current = cachedState.startTime;
				// Calcular tiempo transcurrido
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

	// Intervalo para incrementar el tiempo cuando está playing o launching
	useEffect(() => {
		let interval: NodeJS.Timeout | null = null;
		
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
			// Solo procesar si el evento es para esta instancia
			if (data.instance_id !== instanceId) {
				return;
			}
			
			// Guardar tiempo total jugado antes de resetear
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
			// Limpiar caché cuando el juego termina
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
		try {
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
			
			await invoke('stop_minecraft_instance', { instanceId: instanceId });
			setState('idle');
			setPlayTime(0);
			launchStateCache.delete(instanceId);
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
				return 'JUGAR';
		}
	};

	const getButtonClass = () => {
		const baseClass = "text-white font-bold text-xl px-16 py-8 rounded-2xl shadow-2xl transform transition-all duration-500 ease-out text-center relative overflow-hidden min-w-[16rem] hover:scale-105";
		const currentCachedState = launchStateCache.get(instanceId);
		const currentState = currentCachedState?.state || state;
		if (currentState === 'playing' || currentState === 'launching') {
			return `${baseClass} bg-gradient-to-r from-[#00ffff]/20 via-[#00d4ff]/20 to-[#00ffff]/20 hover:from-[#00ffff]/30 hover:via-[#00d4ff]/30 hover:to-[#00ffff]/30 neon-glow-cyan`;
		}
		return `${baseClass} bg-gradient-to-r from-[#00ffff]/10 via-[#ff00ff]/10 to-[#00ffff]/10 hover:from-[#00ffff]/20 hover:via-[#ff00ff]/20 hover:to-[#00ffff]/20 neon-glow-cyan-hover`;
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
				borderColor: isHovered ? 'rgba(0, 255, 255, 0.8)' : 'rgba(0, 255, 255, 0.5)',
				transition: 'all 0.5s cubic-bezier(0.4, 0, 0.2, 1)'
			};
		}
		return {
			background: 'rgba(0, 0, 0, 0.6)',
			backdropFilter: 'blur(24px)',
			WebkitBackdropFilter: 'blur(24px)',
			boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.7)',
			border: '1px solid',
			borderColor: isHovered ? 'rgba(0, 255, 255, 0.7)' : 'rgba(0, 255, 255, 0.4)',
			transition: 'all 0.5s cubic-bezier(0.4, 0, 0.2, 1)'
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
						<svg 
							className="w-6 h-6 text-white" 
							fill="currentColor" 
							viewBox="0 0 24 24"
						>
							<rect x="6" y="6" width="12" height="12" rx="1" />
						</svg>
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
