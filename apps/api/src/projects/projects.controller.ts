import { Body, Controller, Delete, Get, HttpCode, Inject, Ip, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  CreateProjectSchema,
  ListProjectsQuerySchema,
  UpdateProjectSchema,
  type CreateProjectInput,
  type UpdateProjectInput,
} from '@mya/shared';
import type { z } from 'zod';
import { CurrentUser } from '../auth/decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { ProjectsService } from './projects.service.js';

@Controller('projects')
export class ProjectsController {
  constructor(@Inject(ProjectsService) private readonly projects: ProjectsService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(CreateProjectSchema)) body: CreateProjectInput, @Ip() ip: string) {
    return this.projects.create(user, body, ip);
  }

  @Get()
  list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(ListProjectsQuerySchema)) q: z.infer<typeof ListProjectsQuerySchema>) {
    return this.projects.list(user, q);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.projects.get(user, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(UpdateProjectSchema)) body: UpdateProjectInput,
    @Ip() ip: string,
  ) {
    return this.projects.update(user, id, body, ip);
  }

  @Post(':id/restore')
  @HttpCode(200)
  restore(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string, @Ip() ip: string) {
    return this.projects.restore(user, id, ip);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string, @Ip() ip: string) {
    await this.projects.remove(user, id, ip);
  }
}
