import express, { type Express, type ErrorRequestHandler } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import website from "./routes/website";
import { logger } from "./lib/logger";
import { isAllowedOrigin } from "./lib/auth";
import { authMiddleware } from "./middlewares/authMiddleware";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(
  cors({
    credentials: true,
    origin: (requestOrigin, callback) => {
      // Native clients do not send an Origin header. Let those requests
      // through without reflecting an arbitrary origin.
      if (!requestOrigin) {
        callback(null, true);
        return;
      }

      callback(null, isAllowedOrigin(requestOrigin) ? requestOrigin : false);
    },
    methods: ["GET", "HEAD", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type", "X-Mabhazi-Account", "X-Mabhazi-Blocked-Contributors"],
    maxAge: 600,
  }),
);
app.use(website);
app.use(cookieParser());
app.use('/api/v2', express.json({ limit: 65536, inflate: false }));
const v2BodyErrors: ErrorRequestHandler = (error, _req, res, next) => {
  const status = (error as { status?: number }).status;
  if (![400, 413, 415].includes(status ?? 0)) { next(error); return; }
  res.setHeader('Cache-Control', 'no-store');
  res.status(status!).json({ error: status === 413 ? 'This contribution is too large.' : 'Submit a valid uncompressed JSON contribution.',
    code: status === 413 ? 'BODY_TOO_LARGE' : status === 415 ? 'JSON_REQUIRED' : 'INVALID_JSON' });
};
app.use('/api/v2', v2BodyErrors);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(authMiddleware);

app.use("/api", router);

const v2UnexpectedErrors: ErrorRequestHandler = (_error, _req, res, next) => {
  if (res.headersSent) { next(_error); return; }
  res.setHeader('Cache-Control', 'no-store');
  res.status(503).json({ error: 'The request could not be confirmed. Keep your draft and check its receipt before retrying.', code: 'TEMPORARILY_UNAVAILABLE' });
};
app.use('/api/v2', v2UnexpectedErrors);

export default app;

