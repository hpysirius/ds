import { PartialType } from '@nestjs/swagger';
import { CreatePresetDto } from './create-preset.dto';

export class UpdatePresetDto extends PartialType(CreatePresetDto) {}
