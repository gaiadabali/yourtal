import { Injectable } from "@nestjs/common";
import type { CallHandler, ExecutionContext, NestInterceptor } from "@nestjs/common";
import { Observable } from "rxjs";
import { regionScope, requestRegion } from "./region-scope";

/** Runs the handler inside the region PdpGuard marked, if any (13.5.e). */
@Injectable()
export class RegionScopeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const region = requestRegion(context.switchToHttp().getRequest<object>());
    if (region === undefined) return next.handle();
    return new Observable((subscriber) => {
      const subscription = regionScope.run({ region }, () => next.handle().subscribe(subscriber));
      return () => {
        subscription.unsubscribe();
      };
    });
  }
}
