import { InsightFacade } from '../controller/InsightFacade.js';

const facade = new InsightFacade();

interface RouteApp {
  get(path: string, handler: unknown): void;
  put(path: string, handler: unknown): void;
  post(path: string, handler: unknown): void;
}

/**
 * Express-style server whose route handlers are class methods passed by
 * reference (`Server.echo`, `facade.addDataset`) instead of inline arrows —
 * the CourseInsights shape that used to yield zero workflows.
 */
export class Server {
  private express: RouteApp = null as never;

  public registerRoutes(): void {
    this.express.get('/echo/:msg', Server.echo);
    this.express.put('/dataset/:id/:kind', facade.addDataset);
    this.express.post('/query', Server.performQuery);
  }

  public static echo(req: { params: { msg: string } }, res: { status(code: number): { json(v: unknown): void } }): void {
    res.status(200).json({ result: Server.performEcho(req.params.msg) });
  }

  // Arrow-function class property handler — the other common Express shape.
  public static performQuery = async (req: { body: string }, res: { status(code: number): { json(v: unknown): void } }): Promise<void> => {
    if (!req.body) {
      throw new Error('query body is required');
    }
    const rows = await facade.performQuery(req.body);
    res.status(200).json({ result: rows });
  };

  public static performEcho(msg: string): string {
    if (typeof msg !== 'string' || msg.length === 0) {
      throw new Error('message is required');
    }
    return `${msg}...${msg}`;
  }
}
