import { invoke } from '@tauri-apps/api/core';

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

class FrontendLogger {
  private static instance: FrontendLogger;
  private isLogging = false;
  private originalError: typeof console.error;
  private originalWarn: typeof console.warn;
  private originalLog: typeof console.log;
  private originalInfo: typeof console.info;
  private originalDebug: typeof console.debug;
  
  private constructor() {
    // Save the original methods before intercepting
    this.originalError = console.error.bind(console);
    this.originalWarn = console.warn.bind(console);
    this.originalLog = console.log.bind(console);
    this.originalInfo = console.info.bind(console);
    this.originalDebug = console.debug.bind(console);
    
    this.setupGlobalErrorHandlers();
  }
  
  static getInstance(): FrontendLogger {
    if (!FrontendLogger.instance) {
      FrontendLogger.instance = new FrontendLogger();
    }
    return FrontendLogger.instance;
  }
  
  /**
   * Sets up the global error handlers
   */
  private setupGlobalErrorHandlers() {
    // Intercept console.error, console.warn, console.log, etc.
    this.interceptConsole();

    // Capture unhandled errors
    window.addEventListener('error', (event) => {
      const errorObject = event.error ?? { message: event.message };
      void this.error('Unhandled Error', errorObject, 'window.error', {
        stack: event.error?.stack,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      });
    });
    
    // Capture rejected promises
    window.addEventListener('unhandledrejection', (event) => {
      void this.error('Unhandled Promise Rejection', event.reason, 'unhandledrejection', {
        reason: event.reason,
      });
    });

    // Capture React errors (when used with an Error Boundary)
    // The Error Boundary must call logger.error() manually
  }

  /**
   * Intercepts the console methods to capture all logs
   */
  private interceptConsole() {
    // Intercept console.error
    console.error = (...args: any[]) => {
      this.originalError.apply(console, args);
      if (!this.isLogging) {
        const message = this.formatConsoleArgs(args);
        void this.log('error', message, 'console.error');
      }
    };

    // Intercept console.warn
    console.warn = (...args: any[]) => {
      this.originalWarn.apply(console, args);
      if (!this.isLogging) {
        const message = this.formatConsoleArgs(args);
        void this.log('warn', message, 'console.warn');
      }
    };

    // Intercept console.log
    console.log = (...args: any[]) => {
      this.originalLog.apply(console, args);
      if (!this.isLogging) {
        const message = this.formatConsoleArgs(args);
        void this.log('info', message, 'console.log');
      }
    };

    // Intercept console.info
    console.info = (...args: any[]) => {
      this.originalInfo.apply(console, args);
      if (!this.isLogging) {
        const message = this.formatConsoleArgs(args);
        void this.log('info', message, 'console.info');
      }
    };

    // Intercept console.debug
    console.debug = (...args: any[]) => {
      this.originalDebug.apply(console, args);
      if (!this.isLogging) {
        const message = this.formatConsoleArgs(args);
        void this.log('debug', message, 'console.debug');
      }
    };
  }

  /**
   * Formats the console arguments to create a readable message
   */
  private formatConsoleArgs(args: any[]): string {
    return args.map(arg => {
      if (arg instanceof Error) {
        return `${arg.message}${arg.stack ? '\n' + arg.stack : ''}`;
      } else if (typeof arg === 'object') {
        try {
          return JSON.stringify(arg, null, 2);
        } catch {
          return String(arg);
        }
      }
      return String(arg);
    }).join(' ');
  }
  
  /**
   * Logs a message
   */
  private async log(level: LogLevel, message: string, context?: string, data?: any) {
    // Avoid infinite recursion
    if (this.isLogging) {
      return;
    }
    
    this.isLogging = true;
    
    try {
    let fullMessage = message;
    if (data) {
      try {
        fullMessage += '\n' + JSON.stringify(data, null, 2);
      } catch (e) {
        fullMessage += '\n[Data serialization failed]';
      }
    }
    
    try {
      await invoke('log_frontend_error', {
        level,
        message: fullMessage,
        context: context || undefined,
      });
    } catch (error) {
        this.originalError('Failed to log to backend:', error);
      }
    } finally {
      this.isLogging = false;
    }
  }
  
  /**
   * Logs an info message
   */
  async info(message: string, context?: string, data?: any) {
    return this.log('info', message, context, data);
  }

  /**
   * Logs a warning
   */
  async warn(message: string, context?: string, data?: any) {
    return this.log('warn', message, context, data);
  }

  /**
   * Logs an error
   */
  async error(message: string, error?: any, context?: string, extraData?: any) {
    let errorData: Record<string, any> | undefined;

    if (error instanceof Error) {
      errorData = {
        message: error.message,
        stack: error.stack,
      };

      // Include additional error properties if they exist
      const enumerableProps: Record<string, unknown> = {};
      const errorAny = error as unknown as Record<string, unknown>;
      for (const key of Object.getOwnPropertyNames(error)) {
        if (key !== 'message' && key !== 'stack') {
          enumerableProps[key] = errorAny[key];
        }
      }
      if (Object.keys(enumerableProps).length > 0) {
        errorData = { ...errorData, ...enumerableProps };
      }
    } else if (error !== undefined) {
      if (typeof error === 'object') {
        errorData = { ...error };
      } else {
        errorData = { value: error };
      }
    }

    if (extraData) {
      errorData = { ...(errorData || {}), ...extraData };
    }

    return this.log('error', message, context, errorData);
  }
  
  /**
   * Logs a debug message
   */
  async debug(message: string, context?: string, data?: any) {
    return this.log('debug', message, context, data);
  }

  /**
   * Gets all the frontend logs
   */
  async getLogs(): Promise<string> {
    try {
      return await invoke<string>('get_frontend_logs');
    } catch (error) {
      console.error('Failed to get frontend logs:', error);
      return 'Failed to retrieve logs';
    }
  }
  
  /**
   * Clears all the frontend logs
   */
  async clearLogs(): Promise<void> {
    try {
      await invoke('clear_frontend_logs');
    } catch (error) {
      console.error('Failed to clear frontend logs:', error);
    }
  }
  
  /**
   * Opens the logs folder in the file explorer
   */
  async openLogFolder(): Promise<void> {
    try {
      await invoke('open_frontend_log_folder');
    } catch (error) {
      console.error('Failed to open log folder:', error);
    }
  }
}

// Export singleton instance
export const logger = FrontendLogger.getInstance();

// Also export the class for special cases
export default FrontendLogger;

