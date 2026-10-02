import { PartialType } from '@nestjs/swagger';
import { CreateUserDto } from './create-user.dto';

// 所有字段均可选；status / permissions 等已在 CreateUserDto 中声明
export class UpdateUserDto extends PartialType(CreateUserDto) {}
