import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { healthLinks, WithLinks } from '../../common/http/hateoas';
import { AppConfigService } from '../../config/app-config.service';
import { HealthDto } from './dto/health.dto';
import { Health, HealthService } from './health.service';

/**
 * The public health surface.
 *
 * The detailed view (model id, GPU, world version) is useful for a developer but is information an
 * attacker can use to fingerprint the deployment. In production the public routes therefore answer
 * with a masked payload; the full detail stays available to admins through
 * `GET /api/v1/admin/health` (prompt_security S1.1).
 */
@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthService,
    private readonly config: AppConfigService,
  ) {}

  /** Always 200: read `status`. */
  @Get()
  @WithLinks({ resource: healthLinks })
  @ApiOkResponse({ type: HealthDto })
  async get(): Promise<Health | Record<string, unknown>> {
    const h = await this.health.health();
    return this.mask(h);
  }

  /** Liveness: the process answers, no dependency is called. */
  @Get('live')
  @ApiOkResponse({ schema: { example: { status: 'ok' } } })
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /** Readiness: 503 when Mongo or Qdrant is down. */
  @Get('ready')
  @WithLinks({ resource: healthLinks })
  @ApiOkResponse({ type: HealthDto })
  @ApiServiceUnavailableResponse({ type: HealthDto })
  async ready(@Res({ passthrough: true }) res: Response): Promise<unknown> {
    const h = await this.health.health();
    if (h.status === 'down') res.status(HttpStatus.SERVICE_UNAVAILABLE);
    return this.mask(h);
  }

  /** Keeps only the coarse status outside production. */
  private mask(h: Health): Health | Record<string, unknown> {
    if (this.config.get('NODE_ENV') !== 'production') return h;
    return {
      status: h.status,
      version: h.version,
      uptime_s: h.uptime_s,
      components: {
        mongo: h.components.mongo,
        qdrant: h.components.qdrant,
        llm: h.components.llm,
        world: h.components.world,
      },
    };
  }
}
