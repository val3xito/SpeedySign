/**
 * Logger centralizado con niveles de severidad y contexto
 * Facilita debugging en desarrollo y producción
 */

enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

interface LogContext {
  component?: string;
  function?: string;
  userId?: string;
  extra?: Record<string, any>;
}

interface LogEntry {
  timestamp: number;
  level: LogLevel;
  message: string;
  context?: LogContext;
}

class Logger {
  private level: LogLevel = __DEV__ ? LogLevel.DEBUG : LogLevel.WARN;
  private logs: LogEntry[] = [];
  private readonly MAX_LOGS = 1000; // Límite de logs en memoria

  private log(level: LogLevel, message: string, context?: LogContext): void {
    if (level < this.level) return;

    const logEntry: LogEntry = {
      timestamp: Date.now(),
      level,
      message,
      context,
    };

    this.logs.push(logEntry);

    // Mantener límite de logs
    if (this.logs.length > this.MAX_LOGS) {
      this.logs.shift();
    }

    const levelName = LogLevel[level];
    const emoji = { DEBUG: '🔍', INFO: 'ℹ️', WARN: '⚠️', ERROR: '❌' }[levelName];
    
    const contextStr = context ? JSON.stringify(context, null, 2) : '';
    
    console.log(
      `${emoji} [${levelName}] ${message}`,
      contextStr ? `\nContext: ${contextStr}` : ''
    );

    // En producción, podrías enviar errores a un servicio de analytics
    if (!__DEV__ && level === LogLevel.ERROR) {
      this.reportToAnalytics(logEntry);
    }
  }

  debug(message: string, context?: LogContext): void {
    this.log(LogLevel.DEBUG, message, context);
  }

  info(message: string, context?: LogContext): void {
    this.log(LogLevel.INFO, message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.log(LogLevel.WARN, message, context);
  }

  error(message: string, error?: Error, context?: LogContext): void {
    this.log(LogLevel.ERROR, message, {
      ...context,
      extra: {
        ...context?.extra,
        errorMessage: error?.message,
        errorStack: error?.stack,
      },
    });
  }

  private reportToAnalytics(logEntry: LogEntry): void {
    // Aquí integrarías con Sentry, Firebase Analytics, etc.
    // Ejemplo: Analytics.logEvent('app_error', logEntry);
  }

  getLogs(): LogEntry[] {
    return [...this.logs];
  }

  clearLogs(): void {
    this.logs = [];
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }
}

export const logger = new Logger();
export { LogLevel };
