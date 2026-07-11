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
    // Guardar los métodos originales antes de interceptar
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
   * Configura los manejadores globales de errores
   */
  private setupGlobalErrorHandlers() {
    // Interceptar console.error, console.warn, console.log, etc.
    this.interceptConsole();
    
    // Capturar errores no manejados
    window.addEventListener('error', (event) => {
      const errorObject = event.error ?? { message: event.message };
      void this.error('Unhandled Error', errorObject, 'window.error', {
        stack: event.error?.stack,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      });
    });
    
    // Capturar promesas rechazadas
    window.addEventListener('unhandledrejection', (event) => {
      void this.error('Unhandled Promise Rejection', event.reason, 'unhandledrejection', {
        reason: event.reason,
      });
    });
    
    // Capturar errores de React (si se usa con un Error Boundary)
    // El Error Boundary debe llamar a logger.error() manualmente
  }
  
  /**
   * Intercepta los métodos de console para capturar todos los logs
   */
  private interceptConsole() {
    // Interceptar console.error
    console.error = (...args: any[]) => {
      this.originalError.apply(console, args);
      if (!this.isLogging) {
        const message = this.formatConsoleArgs(args);
        void this.log('error', message, 'console.error');
      }
    };
    
    // Interceptar console.warn
    console.warn = (...args: any[]) => {
      this.originalWarn.apply(console, args);
      if (!this.isLogging) {
        const message = this.formatConsoleArgs(args);
        void this.log('warn', message, 'console.warn');
      }
    };
    
    // Interceptar console.log
    console.log = (...args: any[]) => {
      this.originalLog.apply(console, args);
      if (!this.isLogging) {
        const message = this.formatConsoleArgs(args);
        void this.log('info', message, 'console.log');
      }
    };
    
    // Interceptar console.info
    console.info = (...args: any[]) => {
      this.originalInfo.apply(console, args);
      if (!this.isLogging) {
        const message = this.formatConsoleArgs(args);
        void this.log('info', message, 'console.info');
      }
    };
    
    // Interceptar console.debug
    console.debug = (...args: any[]) => {
      this.originalDebug.apply(console, args);
      if (!this.isLogging) {
        const message = this.formatConsoleArgs(args);
        void this.log('debug', message, 'console.debug');
      }
    };
  }
  
  /**
   * Formatea los argumentos de console para crear un mensaje legible
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
   * Registra un mensaje en los logs
   */
  private async log(level: LogLevel, message: string, context?: string, data?: any) {
    // Evitar recursión infinita
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
   * Registra un mensaje de información
   */
  async info(message: string, context?: string, data?: any) {
    return this.log('info', message, context, data);
  }
  
  /**
   * Registra una advertencia
   */
  async warn(message: string, context?: string, data?: any) {
    return this.log('warn', message, context, data);
  }
  
  /**
   * Registra un error
   */
  async error(message: string, error?: any, context?: string, extraData?: any) {
    let errorData: Record<string, any> | undefined;

    if (error instanceof Error) {
      errorData = {
        message: error.message,
        stack: error.stack,
      };

      // Incluir propiedades adicionales del error si existen
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
   * Registra un mensaje de debug
   */
  async debug(message: string, context?: string, data?: any) {
    return this.log('debug', message, context, data);
  }
  
  /**
   * Obtiene todos los logs del frontend
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
   * Limpia todos los logs del frontend
   */
  async clearLogs(): Promise<void> {
    try {
      await invoke('clear_frontend_logs');
    } catch (error) {
      console.error('Failed to clear frontend logs:', error);
    }
  }
  
  /**
   * Abre la carpeta de logs en el explorador de archivos
   */
  async openLogFolder(): Promise<void> {
    try {
      await invoke('open_frontend_log_folder');
    } catch (error) {
      console.error('Failed to open log folder:', error);
    }
  }
}

// Exportar instancia singleton
export const logger = FrontendLogger.getInstance();

// Exportar también la clase para casos especiales
export default FrontendLogger;

