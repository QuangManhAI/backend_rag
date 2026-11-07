import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Links, rootLinksV2 } from '../../../common/http/hateoas';

/** `GET /api/v2`: where a v2 hypermedia client starts. */
@ApiTags('API root')
@Controller('api/v2')
export class ApiRootV2Controller {
  @Get()
  @ApiOkResponse({ description: 'Links to every top-level v2 resource' })
  root(): { name: string; version: string; _links: Links } {
    return { name: 'RAG_TS API', version: 'v2', _links: rootLinksV2() };
  }
}

