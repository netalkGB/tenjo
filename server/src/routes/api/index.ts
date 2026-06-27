import express from 'express';
import { loginRouter } from './login';
import { registerRouter } from './register';
import { logoutRouter } from './logout';
import { whoamiRouter } from './whoami';
import { chatRouter } from './chat';
import { settingsRouter } from './settings';
import { knowledgeRouter } from './knowledge';
import { agentRouter } from './agent';

export const apiRouter = express.Router();
apiRouter.use('/login', loginRouter);
apiRouter.use('/register', registerRouter);
apiRouter.use('/logout', logoutRouter);
apiRouter.use('/whoami', whoamiRouter);
apiRouter.use('/chat', chatRouter);
apiRouter.use('/settings', settingsRouter);
apiRouter.use('/knowledge', knowledgeRouter);
apiRouter.use('/agent', agentRouter);
