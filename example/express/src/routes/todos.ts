import { Router, type Request, type Response } from 'express';
import { TodoListService } from '../services/todo-list.service';

const router: Router = Router();
/**
 * GET endpoint to fetch current tasks (scoped by userId).
 * Used by frontends on initial load to sync state.
 */
router.get('/', async (req: Request, res: Response) => {
  const userId = (req.query.userId as string) || (req.query.userId as string) || 'anonymous';
  
  try {
    const result = await TodoListService.listTasks(userId);
    res.json({ tasks: result.tasks });
  } catch (err) {
    console.error('Failed to fetch tasks:', err);
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
});

router.post('/', async (req: Request, res: Response) => {
  const userId = (req.query.userId as string) || (req.query.userId as string) || 'anonymous';
  const { title, description } = req.body;
  const result = await TodoListService.createTask(userId, title, description, {
    broadcast: true,
    excludeSender: true,
  });
  res.json(result);
});

router.put('/:taskId', async (req: Request, res: Response) => {
  const userId = (req.query.userId as string) || (req.query.userId as string) || 'anonymous';
  const { taskId } = req.params;
  const { title, description } = req.body;
  const result = await TodoListService.updateTask(userId, taskId, { title, description }, {
    broadcast: true,
    excludeSender: true,
  });
  res.json(result);
});

router.delete('/:taskId', async (req: Request, res: Response) => {
  const userId = (req.query.userId as string) || (req.query.userId as string) || 'anonymous';
  const { taskId } = req.params;
  const result = await TodoListService.deleteTask(userId, taskId, {
    broadcast: true,
    excludeSender: true,
  });
  res.json(result);
});

export default router;