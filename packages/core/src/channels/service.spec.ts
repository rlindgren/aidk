import { ChannelService, type ChannelTransport, type ChannelAdapter } from './service';
import { Context } from '../context';
import type { EngineContext } from '../types';

describe('ChannelService', () => {
  let service: ChannelService;
  let mockCtx: EngineContext;

  beforeEach(() => {
    mockCtx = Context.create({
      user: { id: 'user-123' },
      metadata: { conversationId: 'conv-456' },
    });
    service = new ChannelService();
  });

  afterEach(() => {
    service.destroy();
  });

  describe('getSession', () => {
    it('should create session if not exists', () => {
      const session = service.getSession(mockCtx);
      expect(session).toBeDefined();
      expect(session.id).toBe('user-123-conv-456');
    });

    it('should return same session for same context', () => {
      const session1 = service.getSession(mockCtx);
      const session2 = service.getSession(mockCtx);
      expect(session1).toBe(session2);
    });

    it('should create different sessions for different contexts', () => {
      const ctx1 = Context.create({
        user: { id: 'user-1' },
        metadata: { conversationId: 'conv-1' },
      });
      const ctx2 = Context.create({
        user: { id: 'user-2' },
        metadata: { conversationId: 'conv-2' },
      });

      const session1 = service.getSession(ctx1);
      const session2 = service.getSession(ctx2);

      expect(session1.id).toBe('user-1-conv-1');
      expect(session2.id).toBe('user-2-conv-2');
      expect(session1).not.toBe(session2);
    });

    it('should use custom session ID generator', () => {
      const customService = new ChannelService({
        sessionIdGenerator: (ctx) => `custom-${ctx.traceId}`,
      });

      const session = customService.getSession(mockCtx);
      expect(session.id).toBe(`custom-${mockCtx.traceId}`);
    });
  });

  describe('getChannel', () => {
    it('should get or create channel within session', () => {
      const channel = service.getChannel(mockCtx, 'test-channel');
      expect(channel).toBeDefined();
      expect(channel.name).toBe('test-channel');
    });

    it('should return same channel instance', () => {
      const channel1 = service.getChannel(mockCtx, 'test-channel');
      const channel2 = service.getChannel(mockCtx, 'test-channel');
      expect(channel1).toBe(channel2);
    });
  });

  describe('publish', () => {
    it('should publish to local channel', (done) => {
      const channel = service.getChannel(mockCtx, 'test-channel');
      channel.subscribe((event) => {
        expect(event.type).toBe('test');
        expect(event.payload).toEqual({ message: 'hello' });
        done();
      });

      service.publish(mockCtx, 'test-channel', {
        type: 'test',
        payload: { message: 'hello' },
      });
    });

    it('should add executionId to metadata', (done) => {
      const channel = service.getChannel(mockCtx, 'test-channel');
      channel.subscribe((event) => {
        expect(event.metadata?.executionId).toBe(mockCtx.traceId);
        done();
      });

      service.publish(mockCtx, 'test-channel', {
        type: 'test',
        payload: {},
      });
    });
  });

  describe('subscribe', () => {
    it('should subscribe to channel events', (done) => {
      const unsubscribe = service.subscribe(mockCtx, 'test-channel', (event) => {
        expect(event.type).toBe('test');
        done();
      });

      service.publish(mockCtx, 'test-channel', {
        type: 'test',
        payload: {},
      });

      unsubscribe();
    });
  });

  describe('waitForResponse', () => {
    it('should wait for response on channel', async () => {
      const requestId = 'req-123';
      const responsePromise = service.waitForResponse(mockCtx, 'test-channel', requestId, 1000);

      setTimeout(() => {
        service.publish(mockCtx, 'test-channel', {
          type: 'response',
          id: requestId,
          payload: { answer: 'yes' },
        });
      }, 10);

      const response = await responsePromise;
      expect(response.type).toBe('response');
      expect(response.id).toBe(requestId);
    });
  });

  describe('transport integration', () => {
    it('should connect transport on session creation', async () => {
      const mockTransport: ChannelTransport = {
        name: 'test-transport',
        connect: jest.fn().mockResolvedValue(undefined),
        disconnect: jest.fn().mockResolvedValue(undefined),
        send: jest.fn().mockResolvedValue(undefined),
        onReceive: jest.fn(),
        closeAll: jest.fn(),
      };

      const serviceWithTransport = new ChannelService({
        transport: mockTransport,
      });

      serviceWithTransport.getSession(mockCtx);

      // Wait a bit for async connect
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockTransport.connect).toHaveBeenCalledWith('user-123-conv-456');
    });

    it('should forward published events to transport', async () => {
      const mockTransport: ChannelTransport = {
        name: 'test-transport',
        connect: jest.fn().mockResolvedValue(undefined),
        disconnect: jest.fn().mockResolvedValue(undefined),
        send: jest.fn().mockResolvedValue(undefined),
        onReceive: jest.fn(),
        closeAll: jest.fn(),
      };

      const serviceWithTransport = new ChannelService({
        transport: mockTransport,
      });

      serviceWithTransport.publish(mockCtx, 'test-channel', {
        type: 'test',
        payload: {},
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockTransport.send).toHaveBeenCalled();
      const sentEvent = (mockTransport.send as jest.Mock).mock.calls[0][0];
      expect(sentEvent.channel).toBe('test-channel');
      expect(sentEvent.type).toBe('test');
    });
  });

  describe('adapter integration', () => {
    it('should forward published events to adapter', async () => {
      const mockAdapter: ChannelAdapter = {
        name: 'test-adapter',
        publish: jest.fn().mockResolvedValue(undefined),
        subscribe: jest.fn().mockResolvedValue(() => {}),
      };

      const serviceWithAdapter = new ChannelService({
        adapter: mockAdapter,
      });

      serviceWithAdapter.publish(mockCtx, 'test-channel', {
        type: 'test',
        payload: {},
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockAdapter.publish).toHaveBeenCalled();
      const publishedEvent = (mockAdapter.publish as jest.Mock).mock.calls[0][0];
      expect(publishedEvent.channel).toBe('test-channel');
    });

    it('should handle adapter publish errors gracefully', async () => {
      const mockAdapter: ChannelAdapter = {
        name: 'test-adapter',
        publish: jest.fn().mockRejectedValue(new Error('Adapter error')),
        subscribe: jest.fn().mockResolvedValue(() => {}),
      };

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      const serviceWithAdapter = new ChannelService({
        adapter: mockAdapter,
      });

      serviceWithAdapter.publish(mockCtx, 'test-channel', {
        type: 'test',
        payload: {},
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });

    it('should handle transport send errors gracefully', async () => {
      const mockTransport: ChannelTransport = {
        name: 'test-transport',
        connect: jest.fn().mockResolvedValue(undefined),
        disconnect: jest.fn().mockResolvedValue(undefined),
        send: jest.fn().mockRejectedValue(new Error('Transport error')),
        onReceive: jest.fn(),
        closeAll: jest.fn(),
      };

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      const serviceWithTransport = new ChannelService({
        transport: mockTransport,
      });

      serviceWithTransport.publish(mockCtx, 'test-channel', {
        type: 'test',
        payload: {},
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });
  });

  describe('session cleanup', () => {
    it('should cleanup expired sessions via destroySession', () => {
      const session = service.getSession(mockCtx);
      const channel = session.getChannel('test-channel');
      channel.subscribe(() => {});

      expect(channel.getSubscriberCount()).toBe(1);
      expect(service['sessions'].has(session.id)).toBe(true);

      service.destroySession(session.id);

      expect(channel.getSubscriberCount()).toBe(0);
      expect(service['sessions'].has(session.id)).toBe(false);
    });

    it('should handle destroySession for non-existent session', () => {
      expect(() => {
        service.destroySession('non-existent-session');
      }).not.toThrow();
    });
  });

  describe('destroy', () => {
    it('should cleanup all sessions', () => {
      const session = service.getSession(mockCtx);
      const channel = session.getChannel('test-channel');
      channel.subscribe(() => {});

      expect(channel.getSubscriberCount()).toBe(1);

      service.destroy();

      expect(channel.getSubscriberCount()).toBe(0);
    });

    it('should disconnect transport', async () => {
      const mockTransport: ChannelTransport = {
        name: 'test-transport',
        connect: jest.fn().mockResolvedValue(undefined),
        disconnect: jest.fn().mockResolvedValue(undefined),
        send: jest.fn().mockResolvedValue(undefined),
        onReceive: jest.fn(),
        closeAll: jest.fn(),
      };

      const serviceWithTransport = new ChannelService({
        transport: mockTransport,
      });

      serviceWithTransport.getSession(mockCtx);
      serviceWithTransport.destroy();

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockTransport.disconnect).toHaveBeenCalled();
    });
  });
});

