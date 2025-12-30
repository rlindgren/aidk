import { ExecutionGraph } from "./execution-graph";
import { ExecutionHandleImpl } from "./execution-handle";
import { generatePid } from "./execution-types";

describe("ExecutionGraph", () => {
  let graph: ExecutionGraph;

  beforeEach(() => {
    graph = new ExecutionGraph();
  });

  afterEach(() => {
    // Clean up graph
    graph.clear();
  });

  describe("registration", () => {
    it("should register a root execution", () => {
      const pid = generatePid("root");
      const handle = new ExecutionHandleImpl(pid, pid, "root");

      graph.register(handle);

      expect(graph.get(pid)).toBeDefined();
      expect(graph.getHandle(pid)).toBe(handle);
    });

    it("should register a fork execution with parent", () => {
      const parentPid = generatePid("root");
      const parentHandle = new ExecutionHandleImpl(parentPid, parentPid, "root");
      graph.register(parentHandle);

      const forkPid = generatePid("fork");
      const forkHandle = new ExecutionHandleImpl(forkPid, parentPid, "fork", parentPid);
      graph.register(forkHandle, parentPid);

      expect(graph.get(forkPid)).toBeDefined();
      expect(graph.getHandle(forkPid)).toBe(forkHandle);
      expect(graph.getChildren(parentPid)).toHaveLength(1);
      expect(graph.getChildren(parentPid)[0]).toBe(forkHandle);
    });

    it("should register multiple children for a parent", () => {
      const parentPid = generatePid("root");
      const parentHandle = new ExecutionHandleImpl(parentPid, parentPid, "root");
      graph.register(parentHandle);

      const fork1 = new ExecutionHandleImpl(generatePid("fork"), parentPid, "fork", parentPid);
      const fork2 = new ExecutionHandleImpl(generatePid("fork"), parentPid, "fork", parentPid);

      graph.register(fork1, parentPid);
      graph.register(fork2, parentPid);

      expect(graph.getChildren(parentPid)).toHaveLength(2);
    });
  });

  describe("status updates", () => {
    it("should update execution status", () => {
      const pid = generatePid("root");
      const handle = new ExecutionHandleImpl(pid, pid, "root");
      graph.register(handle);

      graph.updateStatus(pid, "completed");

      const context = graph.get(pid);
      expect(context?.status).toBe("completed");
      expect(context?.completedAt).toBeDefined();
    });

    it("should update status with error", () => {
      const pid = generatePid("root");
      const handle = new ExecutionHandleImpl(pid, pid, "root");
      graph.register(handle);

      const error = new Error("Test error");
      graph.updateStatus(pid, "failed", error, "test-phase");

      const context = graph.get(pid);
      expect(context?.status).toBe("failed");
      expect(context?.error?.message).toBe("Test error");
      expect(context?.error?.phase).toBe("test-phase");
    });
  });

  describe("child tracking", () => {
    it("should get all children for a parent", () => {
      const parentPid = generatePid("root");
      const parentHandle = new ExecutionHandleImpl(parentPid, parentPid, "root");
      graph.register(parentHandle);

      const fork1 = new ExecutionHandleImpl(generatePid("fork"), parentPid, "fork", parentPid);
      const fork2 = new ExecutionHandleImpl(generatePid("fork"), parentPid, "fork", parentPid);

      graph.register(fork1, parentPid);
      graph.register(fork2, parentPid);

      const children = graph.getChildren(parentPid);
      expect(children).toHaveLength(2);
      expect(children).toContain(fork1);
      expect(children).toContain(fork2);
    });

    it("should return empty array for parent with no children", () => {
      const parentPid = generatePid("root");
      const parentHandle = new ExecutionHandleImpl(parentPid, parentPid, "root");
      graph.register(parentHandle);

      expect(graph.getChildren(parentPid)).toHaveLength(0);
    });

    it("should return empty array for non-existent parent", () => {
      expect(graph.getChildren("non-existent")).toHaveLength(0);
    });
  });

  describe("outstanding forks", () => {
    it("should get outstanding forks (running children)", () => {
      const parentPid = generatePid("root");
      const parentHandle = new ExecutionHandleImpl(parentPid, parentPid, "root");
      graph.register(parentHandle);

      const fork1 = new ExecutionHandleImpl(generatePid("fork"), parentPid, "fork", parentPid);
      const fork2 = new ExecutionHandleImpl(generatePid("fork"), parentPid, "fork", parentPid);

      graph.register(fork1, parentPid);
      graph.register(fork2, parentPid);

      // Mark one as completed
      fork1.complete({
        timeline: [],
        sections: {},
        tools: [],
        metadata: {},
        ephemeral: [],
        system: [],
      });
      graph.updateStatus(fork1.pid, "completed");

      const outstanding = graph.getOutstandingForks(parentPid);
      expect(outstanding).toHaveLength(1);
      expect(outstanding[0]).toBe(fork2);
    });

    it("should return empty array when all children are completed", () => {
      const parentPid = generatePid("root");
      const parentHandle = new ExecutionHandleImpl(parentPid, parentPid, "root");
      graph.register(parentHandle);

      const fork1 = new ExecutionHandleImpl(generatePid("fork"), parentPid, "fork", parentPid);
      graph.register(fork1, parentPid);

      fork1.complete({
        timeline: [],
        sections: {},
        tools: [],
        metadata: {},
        ephemeral: [],
        system: [],
      });
      graph.updateStatus(fork1.pid, "completed");

      expect(graph.getOutstandingForks(parentPid)).toHaveLength(0);
    });
  });

  describe("orphaned forks", () => {
    it("should detect orphaned forks (parent completed, child running)", () => {
      const parentPid = generatePid("root");
      const parentHandle = new ExecutionHandleImpl(parentPid, parentPid, "root");
      graph.register(parentHandle);

      const forkPid = generatePid("fork");
      const forkHandle = new ExecutionHandleImpl(forkPid, parentPid, "fork", parentPid);
      graph.register(forkHandle, parentPid);

      // Complete parent while fork is still running
      parentHandle.complete({
        timeline: [],
        sections: {},
        tools: [],
        metadata: {},
        ephemeral: [],
        system: [],
      });
      graph.updateStatus(parentPid, "completed");

      const orphaned = graph.getOrphanedForks();
      expect(orphaned).toHaveLength(1);
      expect(orphaned[0]).toBe(forkHandle);
    });

    it("should not include completed forks as orphaned", () => {
      const parentPid = generatePid("root");
      const parentHandle = new ExecutionHandleImpl(parentPid, parentPid, "root");
      graph.register(parentHandle);

      const forkPid = generatePid("fork");
      const forkHandle = new ExecutionHandleImpl(forkPid, parentPid, "fork", parentPid);
      graph.register(forkHandle, parentPid);

      // Complete both parent and fork
      forkHandle.complete({
        timeline: [],
        sections: {},
        tools: [],
        metadata: {},
        ephemeral: [],
        system: [],
      });
      graph.updateStatus(forkPid, "completed");
      parentHandle.complete({
        timeline: [],
        sections: {},
        tools: [],
        metadata: {},
        ephemeral: [],
        system: [],
      });
      graph.updateStatus(parentPid, "completed");

      expect(graph.getOrphanedForks()).toHaveLength(0);
    });

    it("should not include root executions as orphaned", () => {
      const rootPid = generatePid("root");
      const rootHandle = new ExecutionHandleImpl(rootPid, rootPid, "root");
      graph.register(rootHandle);

      expect(graph.getOrphanedForks()).toHaveLength(0);
    });
  });

  describe("execution tree", () => {
    it("should build execution tree for root execution", () => {
      const rootPid = generatePid("root");
      const rootHandle = new ExecutionHandleImpl(rootPid, rootPid, "root");
      graph.register(rootHandle);

      const tree = graph.getExecutionTree(rootPid);
      expect(tree).toBeDefined();
      expect(tree?.pid).toBe(rootPid);
      expect(tree?.children).toHaveLength(0);
    });

    it("should build execution tree with children", () => {
      const rootPid = generatePid("root");
      const rootHandle = new ExecutionHandleImpl(rootPid, rootPid, "root");
      graph.register(rootHandle);

      const fork1Pid = generatePid("fork");
      const fork1Handle = new ExecutionHandleImpl(fork1Pid, rootPid, "fork", rootPid);
      graph.register(fork1Handle, rootPid);

      const fork2Pid = generatePid("fork");
      const fork2Handle = new ExecutionHandleImpl(fork2Pid, rootPid, "fork", rootPid);
      graph.register(fork2Handle, rootPid);

      const tree = graph.getExecutionTree(rootPid);
      expect(tree).toBeDefined();
      expect(tree?.pid).toBe(rootPid);
      expect(tree?.children).toHaveLength(2);
      expect(tree?.children.map((c) => c.pid)).toContain(fork1Pid);
      expect(tree?.children.map((c) => c.pid)).toContain(fork2Pid);
    });

    it("should build nested execution tree", () => {
      const rootPid = generatePid("root");
      const rootHandle = new ExecutionHandleImpl(rootPid, rootPid, "root");
      graph.register(rootHandle);

      const fork1Pid = generatePid("fork");
      const fork1Handle = new ExecutionHandleImpl(fork1Pid, rootPid, "fork", rootPid);
      graph.register(fork1Handle, rootPid);

      const fork2Pid = generatePid("fork");
      const fork2Handle = new ExecutionHandleImpl(fork2Pid, rootPid, "fork", fork1Pid);
      graph.register(fork2Handle, fork1Pid);

      const tree = graph.getExecutionTree(rootPid);
      expect(tree).toBeDefined();
      expect(tree?.children).toHaveLength(1);
      expect(tree?.children[0].pid).toBe(fork1Pid);
      expect(tree?.children[0].children).toHaveLength(1);
      expect(tree?.children[0].children[0].pid).toBe(fork2Pid);
    });

    it("should return undefined for non-existent root", () => {
      expect(graph.getExecutionTree("non-existent")).toBeUndefined();
    });
  });

  describe("queries", () => {
    it("should get all executions", () => {
      const root1 = new ExecutionHandleImpl(generatePid("root"), generatePid("root"), "root");
      const root2 = new ExecutionHandleImpl(generatePid("root"), generatePid("root"), "root");

      graph.register(root1);
      graph.register(root2);

      const all = graph.getAllExecutions();
      expect(all).toHaveLength(2);
      expect(all).toContain(root1);
      expect(all).toContain(root2);
    });

    it("should get executions by status", () => {
      const running = new ExecutionHandleImpl(generatePid("root"), generatePid("root"), "root");
      const completed = new ExecutionHandleImpl(generatePid("root"), generatePid("root"), "root");

      graph.register(running);
      graph.register(completed);

      completed.complete({
        timeline: [],
        sections: {},
        tools: [],
        metadata: {},
        ephemeral: [],
        system: [],
      });
      graph.updateStatus(completed.pid, "completed");

      const runningExecs = graph.getExecutionsByStatus("running");
      const completedExecs = graph.getExecutionsByStatus("completed");

      expect(runningExecs).toHaveLength(1);
      expect(runningExecs[0]).toBe(running);
      expect(completedExecs).toHaveLength(1);
      expect(completedExecs[0]).toBe(completed);
    });

    it("should get executions by type", () => {
      const root = new ExecutionHandleImpl(generatePid("root"), generatePid("root"), "root");
      const spawn = new ExecutionHandleImpl(generatePid("spawn"), generatePid("spawn"), "spawn");
      const fork = new ExecutionHandleImpl(generatePid("fork"), generatePid("root"), "fork");

      graph.register(root);
      graph.register(spawn);
      graph.register(fork);

      const roots = graph.getExecutionsByType("root");
      const spawns = graph.getExecutionsByType("spawn");
      const forks = graph.getExecutionsByType("fork");

      expect(roots).toHaveLength(1);
      expect(spawns).toHaveLength(1);
      expect(forks).toHaveLength(1);
    });
  });

  describe("cleanup", () => {
    it("should remove execution from graph", () => {
      const pid = generatePid("root");
      const handle = new ExecutionHandleImpl(pid, pid, "root");
      graph.register(handle);

      expect(graph.get(pid)).toBeDefined();

      graph.remove(pid);

      expect(graph.get(pid)).toBeUndefined();
    });

    it("should remove child references when removing parent", () => {
      const parentPid = generatePid("root");
      const parentHandle = new ExecutionHandleImpl(parentPid, parentPid, "root");
      graph.register(parentHandle);

      const forkPid = generatePid("fork");
      const forkHandle = new ExecutionHandleImpl(forkPid, parentPid, "fork", parentPid);
      graph.register(forkHandle, parentPid);

      graph.remove(parentPid);

      expect(graph.get(parentPid)).toBeUndefined();
      // Child should still exist but parent reference is removed
      expect(graph.get(forkPid)).toBeDefined();
    });

    it("should clear all executions", () => {
      graph.register(new ExecutionHandleImpl(generatePid("root"), generatePid("root"), "root"));
      graph.register(new ExecutionHandleImpl(generatePid("root"), generatePid("root"), "root"));

      expect(graph.getCount()).toBe(2);

      graph.clear();

      expect(graph.getCount()).toBe(0);
      expect(graph.getAllExecutions()).toHaveLength(0);
    });
  });

  describe("counts", () => {
    it("should get total count", () => {
      expect(graph.getCount()).toBe(0);

      graph.register(new ExecutionHandleImpl(generatePid("root"), generatePid("root"), "root"));
      graph.register(new ExecutionHandleImpl(generatePid("root"), generatePid("root"), "root"));

      expect(graph.getCount()).toBe(2);
    });

    it("should get active count", () => {
      const running1 = new ExecutionHandleImpl(generatePid("root"), generatePid("root"), "root");
      const running2 = new ExecutionHandleImpl(generatePid("root"), generatePid("root"), "root");
      const completed = new ExecutionHandleImpl(generatePid("root"), generatePid("root"), "root");

      graph.register(running1);
      graph.register(running2);
      graph.register(completed);

      completed.complete({
        timeline: [],
        sections: {},
        tools: [],
        metadata: {},
        ephemeral: [],
        system: [],
      });
      graph.updateStatus(completed.pid, "completed");

      expect(graph.getActiveCount()).toBe(2);
    });
  });
});
