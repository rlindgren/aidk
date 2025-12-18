import { Router, type Request, type Response } from 'express';
import { ScratchpadService } from '../services/scratchpad.service';

const router: Router = Router();

export const GLOBAL_THREAD_ID = '00000000-0000-0000-0000-000000000000';

/**
 * GET endpoint to fetch scratchpad notes (scoped by thread_id).
 * Used by frontends on initial load to sync state.
 */
router.get('/', async (req: Request, res: Response) => {
  const threadId = (req.query.thread_id as string) || (req.query.threadId as string) || GLOBAL_THREAD_ID;
  
  try {
    const result = await ScratchpadService.listNotes(threadId);
    res.json({ notes: result.notes });
  } catch (err) {
    console.error('Failed to fetch notes:', err);
    res.status(500).json({ error: 'Failed to fetch notes' });
  }
});

router.post('/', async (req: Request, res: Response) => {
  const threadId = (req.query.thread_id as string) || (req.query.threadId as string) || GLOBAL_THREAD_ID;
  const { text } = req.body;
  const result = await ScratchpadService.addNote(threadId, text, 'user', {
    broadcast: true,
    excludeSender: true,
  });
  res.json(result);
});

// router.put('/:noteId', async (req: Request, res: Response) => {
//   const userId = (req.query.user_id as string) || (req.query.userId as string) || 'anonymous';
//   const { noteId } = req.params;
//   const { text } = req.body;
//   const result = await ScratchpadService.updateNote(threadId, noteId, text, 'user', {
//     broadcast: true,
//     excludeSender: true,
//   });
//   res.json(result);
// });

router.delete('/:taskId', async (req: Request, res: Response) => {
  const threadId = (req.query.thread_id as string) || (req.query.threadId as string) || GLOBAL_THREAD_ID;
  const { noteId } = req.params;
  const result = await ScratchpadService.removeNote(threadId, noteId, {
    broadcast: true,
    excludeSender: true,
  });
  res.json(result);
});

export default router;