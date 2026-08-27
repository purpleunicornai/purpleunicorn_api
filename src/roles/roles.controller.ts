import { Body, Controller, Param, Post } from '@nestjs/common';
import { RolesService } from './roles.service';
import { RoleFilterDto } from '../common/dto/search.dto';

@Controller('roles')
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Post('/:roleId/search')
  async search(@Body() body: RoleFilterDto) {
    return this.rolesService.search(body);
  }
}
