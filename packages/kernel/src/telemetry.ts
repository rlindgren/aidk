export interface Span {
  end(): void;
  setAttribute(key: string, value: any): void;
  recordError(error: any): void;
}

export interface MetricAttributes {
  [key: string]: string | number | boolean;
}

export interface Counter {
  add(value: number, attributes?: MetricAttributes): void;
}

export interface Histogram {
  record(value: number, attributes?: MetricAttributes): void;
}

export interface TelemetryProvider {
  startTrace(name: string): string;
  startSpan(name: string): Span;
  recordError(error: any): void;
  endTrace(): void;
  getCounter(name: string, unit?: string, description?: string): Counter;
  getHistogram(name: string, unit?: string, description?: string): Histogram;
}

class NoOpProvider implements TelemetryProvider {
  startTrace(name: string): string {
    return `trace-${crypto.randomUUID()}`;
  }
  startSpan(name: string): Span {
    return {
      end: () => {},
      setAttribute: () => {},
      recordError: () => {},
    };
  }
  recordError(error: any): void {
    console.error('Telemetry Error:', error);
  }
  endTrace(): void {}
  getCounter(name: string): Counter {
    return { add: () => {} };
  }
  getHistogram(name: string): Histogram {
    return { record: () => {} };
  }
}

export class Telemetry {
  private static provider: TelemetryProvider = new NoOpProvider();

  static setProvider(provider: TelemetryProvider): void {
    this.provider = provider;
  }

  static resetProvider(): void {
    this.provider = new NoOpProvider();
  }

  static startTrace(name: string = 'operation'): string {
    return this.provider.startTrace(name);
  }

  static startSpan(name: string): Span {
    return this.provider.startSpan(name);
  }

  static recordError(error: any): void {
    this.provider.recordError(error);
  }

  static endTrace(): void {
    this.provider.endTrace();
  }

  static getCounter(name: string, unit?: string, description?: string): Counter {
    return this.provider.getCounter(name, unit, description);
  }

  static getHistogram(name: string, unit?: string, description?: string): Histogram {
    return this.provider.getHistogram(name, unit, description);
  }
}
