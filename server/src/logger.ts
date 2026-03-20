import winston from 'winston';
import { isDevelopment } from './utils/env';

const logger = winston.createLogger({
  level: isDevelopment() ? 'debug' : 'info',
  format: winston.format.simple(),
  transports: [new winston.transports.Console()]
});

export default logger;
