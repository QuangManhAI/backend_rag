import { ApiProperty } from '@nestjs/swagger';
import type { Components, Health, HealthStatus } from './health.service';

class ComponentsDto implements Components {
  @ApiProperty() mongo: boolean;
  @ApiProperty() qdrant: boolean;
  @ApiProperty() llm: boolean;
  @ApiProperty({
    description: 'World 3D tree + centroids loaded (route events have steps)',
  })
  world: boolean;
}

class LlmInfoDto {
  @ApiProperty({ example: 'qwen2.5-7b-instruct-q4_k_m' }) model_id: string;
  @ApiProperty({ example: 'metal' }) gpu: string;
  @ApiProperty() queue_length: number;
}

/** `GET /health` (API_DESIGN §6). */
export class HealthDto implements Health {
  @ApiProperty({ enum: ['ok', 'degraded', 'down'] }) status: HealthStatus;
  @ApiProperty({ example: '1.0.0' }) version: string;
  @ApiProperty() uptime_s: number;
  @ApiProperty({ nullable: true, type: String }) world_version: string | null;
  @ApiProperty({ type: ComponentsDto }) components: Components;
  @ApiProperty({ type: LlmInfoDto }) llm: LlmInfoDto;
}
