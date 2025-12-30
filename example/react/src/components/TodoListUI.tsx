import { useState } from "react";
import type { Task } from "../hooks";

interface TodoListUIProps {
  tasks: Task[];
  isLoading: boolean;
  onCreateTask: (task: { title: string; description?: string }) => void;
  onToggleComplete: (taskId: string) => void;
  onDeleteTask: (taskId: string) => void;
}

export function TodoListUI({
  tasks,
  isLoading,
  onCreateTask,
  onToggleComplete,
  onDeleteTask,
}: TodoListUIProps) {
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskDesc, setNewTaskDesc] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskTitle.trim()) return;

    onCreateTask({
      title: newTaskTitle.trim(),
      description: newTaskDesc.trim() || undefined,
    });

    setNewTaskTitle("");
    setNewTaskDesc("");
  };

  const completedCount = tasks.filter((t) => t.completed).length;
  const pendingCount = tasks.length - completedCount;

  return (
    <div className="todo-list">
      <div className="todo-header">
        <h2>Todo List</h2>
        <div className="todo-stats">
          <span className="pending">{pendingCount} pending</span>
          <span className="completed">{completedCount} completed</span>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="add-task-form">
        <input
          type="text"
          value={newTaskTitle}
          onChange={(e) => setNewTaskTitle(e.target.value)}
          placeholder="Task title..."
          disabled={isLoading}
        />
        <input
          type="text"
          value={newTaskDesc}
          onChange={(e) => setNewTaskDesc(e.target.value)}
          placeholder="Description (optional)..."
          disabled={isLoading}
        />
        <button type="submit" disabled={!newTaskTitle.trim() || isLoading}>
          Add Task
        </button>
      </form>

      <div className="tasks-list">
        {tasks.length === 0 && (
          <div className="empty-tasks">
            <p>No tasks yet.</p>
            <p className="hint">Add a task above or ask the assistant to create one.</p>
          </div>
        )}

        {tasks.map((task) => (
          <TaskItem
            key={task.id}
            task={task}
            onToggle={() => onToggleComplete(task.id)}
            onDelete={() => onDeleteTask(task.id)}
          />
        ))}
      </div>
    </div>
  );
}

function TaskItem({
  task,
  onToggle,
  onDelete,
}: {
  task: Task;
  onToggle: () => void;
  onDelete: () => void;
}) {
  return (
    <div className={`task-item ${task.completed ? "completed" : ""}`}>
      <label className="task-checkbox">
        <input type="checkbox" checked={task.completed} onChange={onToggle} />
        <span className="checkmark"></span>
      </label>

      <div className="task-content">
        <span className="task-title">{task.title}</span>
        {task.description && <span className="task-description">{task.description}</span>}
      </div>

      <button className="delete-btn" onClick={onDelete} title="Delete task">
        ×
      </button>
    </div>
  );
}
