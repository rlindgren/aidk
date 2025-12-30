/**
 * App-specific hook for todo list management
 * Uses the new typed channel API
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { useChannel, defineChannel, EngineClient } from "aidk-react";

export interface Task {
  id: string;
  title: string;
  description?: string;
  completed: boolean;
  createdAt?: string;
  updatedAt?: string;
  userId?: string;
}

interface TaskResponse {
  success: boolean;
  tasks?: Task[];
  message?: string;
}

const API_URL = import.meta.env.VITE_API_URL || "";

// Define the todo-list channel contract
const TodoChannel = defineChannel<
  // Incoming events (from server)
  { state_changed: { tasks: Task[] } },
  // Outgoing events (to server)
  {
    create_task: { title: string; description?: string };
    update_task: { task_id: string; updates: Partial<Task> };
    toggle_complete: { task_id: string };
    delete_task: { task_id: string };
  }
>("todo-list");

/**
 * Hook that syncs with TodoListTool via the todo-list channel.
 * Tasks are scoped by userId (not threadId).
 */
export function useTodoList(client: EngineClient, userId: string | null = null) {
  console.log("[useTodoList] Hook called, userId:", userId, "client:", client);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Connect to the todo-list channel
  console.log("[useTodoList] Creating channel...");
  const channel = useChannel(TodoChannel, client);
  console.log("[useTodoList] Channel created:", channel);

  // Subscribe to state changes
  // Use ref to store latest setTasks to avoid recreating handler
  const setTasksRef = useRef(setTasks);
  useEffect(() => {
    setTasksRef.current = setTasks;
  }, [setTasks]);

  useEffect(() => {
    console.log("[useTodoList] Setting up state_changed handler");
    const unsubscribe = channel.on("state_changed", (payload) => {
      console.log("[useTodoList] Received state_changed event:", payload);
      if (payload && typeof payload === "object" && "tasks" in payload) {
        setTasksRef.current((payload as { tasks: Task[] }).tasks);
      } else {
        console.warn("[useTodoList] Unexpected payload structure:", payload);
      }
    });
    return unsubscribe;
  }, [channel]); // Channel is stable from cache, but React needs the dependency

  // Fetch initial tasks on mount
  useEffect(() => {
    const fetchTasks = async () => {
      try {
        const params = new URLSearchParams();
        if (userId) params.set("userId", userId);

        const response = await fetch(`${API_URL}/api/tasks?${params}`);
        if (response.ok) {
          const data = await response.json();
          if (data.tasks) {
            setTasks(data.tasks);
          }
        }
      } catch (err) {
        console.error("Failed to fetch initial tasks:", err);
      }
    };

    fetchTasks();
  }, [userId]);

  const updateTask = useCallback(
    async (taskId: string, updates: Partial<Task>) => {
      // Optimistic update
      setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, ...updates } : t)));

      // Send to server
      const response = (await channel.send("update_task", {
        task_id: taskId,
        updates,
      })) as TaskResponse;

      if (response?.tasks) {
        setTasks(response.tasks);
      }
    },
    [channel],
  );

  const createTask = useCallback(
    async (task: { title: string; description?: string }) => {
      setIsLoading(true);
      try {
        const response = (await channel.send("create_task", task)) as TaskResponse;

        if (response?.tasks) {
          setTasks(response.tasks);
        }
      } finally {
        setIsLoading(false);
      }
    },
    [channel],
  );

  const deleteTask = useCallback(
    async (taskId: string) => {
      // Optimistic update
      setTasks((prev) => prev.filter((t) => t.id !== taskId));

      const response = (await channel.send("delete_task", {
        task_id: taskId,
      })) as TaskResponse;

      if (response?.tasks) {
        setTasks(response.tasks);
      }
    },
    [channel],
  );

  const toggleComplete = useCallback(
    async (taskId: string) => {
      const task = tasks.find((t) => t.id === taskId);
      if (task) {
        // Optimistic update
        setTasks((prev) =>
          prev.map((t) => (t.id === taskId ? { ...t, completed: !t.completed } : t)),
        );

        const response = (await channel.send("toggle_complete", {
          task_id: taskId,
        })) as TaskResponse;

        if (response?.tasks) {
          setTasks(response.tasks);
        }
      }
    },
    [channel, tasks],
  );

  return {
    tasks,
    isLoading,
    createTask,
    updateTask,
    deleteTask,
    toggleComplete,
  };
}
