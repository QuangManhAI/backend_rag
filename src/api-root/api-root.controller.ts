import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Links, rootLinks } from '../common/hateoas';

/** `GET /api/v1`: where a hypermedia client starts. */
@ApiTags('API root')
@Controller()
export class ApiRootController {
  @Get()
  @ApiOkResponse({ description: 'Links to every top-level resource' })
  root(): { name: string; version: string; _links: Links } {
    return { name: 'RAG_TS API', version: 'v1', _links: rootLinks() };
  }
}
