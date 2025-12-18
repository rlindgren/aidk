import { ProcedureGraph, ProcedureNode, ProcedureStatus } from './procedure-graph';

describe('ProcedureGraph', () => {
  let graph: ProcedureGraph;
  
  beforeEach(() => {
    graph = new ProcedureGraph();
  });
  
  afterEach(() => {
    graph.clear();
  });
  
  describe('registration', () => {
    it('should register a root procedure', () => {
      const node = graph.register('proc-1', undefined, 'test-proc');
      
      expect(node).toBeDefined();
      expect(node.pid).toBe('proc-1');
      expect(node.name).toBe('test-proc');
      expect(node.status).toBe('running');
      expect(graph.get('proc-1')).toBe(node);
    });
    
    it('should register a child procedure with parent', () => {
      const parent = graph.register('proc-1', undefined, 'parent');
      const child = graph.register('proc-2', 'proc-1', 'child');
      
      expect(child.parentPid).toBe('proc-1');
      expect(graph.getChildren('proc-1')).toEqual(['proc-2']);
      expect(graph.getParent('proc-2')).toBe('proc-1');
    });
    
    it('should register multiple children for a parent', () => {
      const parent = graph.register('proc-1', undefined, 'parent');
      const child1 = graph.register('proc-2', 'proc-1', 'child1');
      const child2 = graph.register('proc-3', 'proc-1', 'child2');
      
      const children = graph.getChildren('proc-1');
      expect(children).toHaveLength(2);
      expect(children).toContain('proc-2');
      expect(children).toContain('proc-3');
    });
  });
  
  describe('metrics', () => {
    it('should add metrics to a node', () => {
      const node = graph.register('proc-1', undefined, 'test');
      
      node.addMetric('usage.input_tokens', 100);
      node.addMetric('usage.output_tokens', 50);
      
      expect(node.getMetric('usage.input_tokens')).toBe(100);
      expect(node.getMetric('usage.output_tokens')).toBe(50);
    });
    
    it('should accumulate metrics when adding multiple times', () => {
      const node = graph.register('proc-1', undefined, 'test');
      
      node.addMetric('usage.input_tokens', 100);
      node.addMetric('usage.input_tokens', 50);
      
      expect(node.getMetric('usage.input_tokens')).toBe(150);
    });
    
    it('should propagate metrics from child to parent on completion', () => {
      const parent = graph.register('proc-1', undefined, 'parent');
      const child = graph.register('proc-2', 'proc-1', 'child');
      
      child.addMetric('usage.input_tokens', 100);
      child.addMetric('usage.output_tokens', 50);
      
      graph.updateStatus('proc-2', 'completed');
      
      // Parent should have accumulated child's metrics
      expect(parent.getMetric('usage.input_tokens')).toBe(100);
      expect(parent.getMetric('usage.output_tokens')).toBe(50);
    });
    
    it('should propagate metrics even on failure', () => {
      const parent = graph.register('proc-1', undefined, 'parent');
      const child = graph.register('proc-2', 'proc-1', 'child');
      
      child.addMetric('usage.input_tokens', 100);
      
      graph.updateStatus('proc-2', 'failed', new Error('Test error'));
      
      // Parent should still have metrics
      expect(parent.getMetric('usage.input_tokens')).toBe(100);
    });
    
    it('should merge metrics from multiple children', () => {
      const parent = graph.register('proc-1', undefined, 'parent');
      const child1 = graph.register('proc-2', 'proc-1', 'child1');
      const child2 = graph.register('proc-3', 'proc-1', 'child2');
      
      child1.addMetric('usage.input_tokens', 100);
      child2.addMetric('usage.input_tokens', 50);
      
      graph.updateStatus('proc-2', 'completed');
      graph.updateStatus('proc-3', 'completed');
      
      // Parent should have sum of both children
      expect(parent.getMetric('usage.input_tokens')).toBe(150);
    });
  });
  
  describe('status updates', () => {
    it('should update status to completed', () => {
      const node = graph.register('proc-1', undefined, 'test');
      
      graph.updateStatus('proc-1', 'completed');
      
      expect(node.status).toBe('completed');
      expect(node.completedAt).toBeDefined();
    });
    
    it('should update status to failed', () => {
      const node = graph.register('proc-1', undefined, 'test');
      const error = new Error('Test error');
      
      graph.updateStatus('proc-1', 'failed', error);
      
      expect(node.status).toBe('failed');
      expect(node.error).toBe(error);
      expect(node.completedAt).toBeDefined();
    });
    
    it('should update status to cancelled', () => {
      const node = graph.register('proc-1', undefined, 'test');
      
      graph.updateStatus('proc-1', 'cancelled');
      
      expect(node.status).toBe('cancelled');
      expect(node.completedAt).toBeDefined();
    });
  });
  
  describe('node methods', () => {
    it('should complete a node', () => {
      const node = graph.register('proc-1', undefined, 'test');
      
      node.complete();
      
      expect(node.status).toBe('completed');
      expect(node.completedAt).toBeDefined();
    });
    
    it('should fail a node', () => {
      const node = graph.register('proc-1', undefined, 'test');
      const error = new Error('Test error');
      
      node.fail(error);
      
      expect(node.status).toBe('failed');
      expect(node.error).toBe(error);
    });
    
    it('should cancel a node', () => {
      const node = graph.register('proc-1', undefined, 'test');
      
      node.cancel();
      
      expect(node.status).toBe('cancelled');
    });
    
    it('should merge metrics from another source', () => {
      const node = graph.register('proc-1', undefined, 'test');
      
      node.addMetric('usage.input_tokens', 100);
      node.mergeMetrics({ 'usage.output_tokens': 50, 'usage.input_tokens': 25 });
      
      expect(node.getMetric('usage.input_tokens')).toBe(125); // Accumulated
      expect(node.getMetric('usage.output_tokens')).toBe(50);
    });
  });
  
  describe('clear', () => {
    it('should clear all procedures', () => {
      graph.register('proc-1', undefined, 'test1');
      graph.register('proc-2', undefined, 'test2');
      
      expect(graph.getCount()).toBe(2);
      
      graph.clear();
      
      expect(graph.getCount()).toBe(0);
      expect(graph.get('proc-1')).toBeUndefined();
    });
  });
});

