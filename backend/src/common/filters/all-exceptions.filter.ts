import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    let message: any = 'Internal server error';
    // 业务抛的自定义字段（比如 code / punishUrl）要原样透传给前端，前端靠它们做分支处理
    const extra: Record<string, any> = {};
    if (exception instanceof HttpException) {
      const res = exception.getResponse();
      if (typeof res === 'string') {
        message = res;
      } else {
        const obj: any = res;
        message = obj.message || obj;
        for (const [k, v] of Object.entries(obj)) {
          if (!['message', 'statusCode', 'error'].includes(k)) extra[k] = v;
        }
      }
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    if (status >= 500) {
      this.logger.error(`${request.method} ${request.url} -> ${status}`, exception instanceof Error ? exception.stack : '');
      // 5xx 不要把原始 message 回给前端：Prisma / 数据库报错里常带表名、列名、连接地址等内部信息
      message = '服务器内部错误，请稍后重试';
    }

    response.status(status).json({
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      message: Array.isArray(message) ? message[0] : message,
      ...extra,
    });
  }
}
