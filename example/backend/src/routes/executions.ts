import { Router, type Request, type Response } from 'express';
import { getRepositories } from '../setup';

const router: Router = Router();

router.get('/thread/:threadId', async (req: Request, res: Response) => {
  try {
    const { threadId } = req.params;
    const { executionRepo } = getRepositories();
    const executions = await executionRepo.findByThreadId(threadId);
    res.json({ executions });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:executionId', async (req: Request, res: Response) => {
  try {
    const { executionId } = req.params;
    const { executionRepo } = getRepositories();
    const execution = await executionRepo.findById(executionId);
    
    if (!execution) {
      return res.status(404).json({ error: 'Execution not found' });
    }
    
    res.json({ execution });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:executionId/graph', async (req: Request, res: Response) => {
  try {
    const { executionId } = req.params;
    const { executionRepo } = getRepositories();
    const rootExecution = await executionRepo.findById(executionId);
    
    if (!rootExecution) {
      return res.status(404).json({ error: 'Execution not found' });
    }
    
    const graph = await executionRepo.findByRootId(rootExecution.root_id!);
    res.json({ graph });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;



