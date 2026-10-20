import { Controller, Get, Res, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Response } from 'express';
import { WorldService } from './world.service';

@ApiTags('World')
@Controller('api/world')
export class WorldController {
  constructor(private readonly worldService: WorldService) {}

  @Get('categories')
  @ApiOperation({
    summary: 'Get 3D World Categories',
    description: 'Returns the list of arXiv scientific categories with paper distributions.',
  })
  @ApiResponse({ status: HttpStatus.OK, description: 'List of categories.' })
  getCategories() {
    return this.worldService.getCategories();
  }

  @Get('ground')
  @ApiOperation({
    summary: 'Get 3D Ground Layout',
    description: 'Returns grid tiles, book crates, and subterranean roots.',
  })
  @ApiResponse({ status: HttpStatus.OK, description: 'Ground layout with crates and roots.' })
  getGround() {
    return this.worldService.getGround();
  }

  @Get('tree')
  @ApiOperation({
    summary: 'Get 3D Hierarchical Tree Structure',
    description: 'Returns trunk, branch (depth 1), and twig (depth 2) nodes.',
  })
  @ApiResponse({ status: HttpStatus.OK, description: 'Hierarchical tree structure.' })
  getTree() {
    return this.worldService.getTree();
  }

  @Get('vectors.bin')
  @ApiOperation({
    summary: 'Get Binary Vector Buffer',
    description: 'Returns binary column-stride buffer (VTRE v2) encoding positions, categories, and years.',
  })
  @ApiResponse({ status: HttpStatus.OK, description: 'Binary vector buffer.' })
  getVectorsBin(@Res() res: Response) {
    const buffer = this.worldService.getVectorsBuffer();
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', buffer.byteLength.toString());
    res.send(Buffer.from(buffer));
  }

  @Get('vector-ids')
  @ApiOperation({
    summary: 'Get Paper Vector IDs',
    description: 'Returns the ordered array of arXiv paper IDs matching vectors.bin.',
  })
  @ApiResponse({ status: HttpStatus.OK, description: 'Array of paper IDs.' })
  getVectorIds() {
    return this.worldService.getVectorIds();
  }
}
