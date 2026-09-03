import { HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../common/database/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { RequestException } from '../common/exception/core/ExceptionBase';
import { CreateRoleDto, UpdateRoleDto } from './dto/role.dto';
import { RoleFilterDto } from './dto/role_filter.dto';
import { Prisma, role_filters, roles } from '../generated/prisma/client';
import { InputJsonValue } from '../generated/prisma/internal/prismaNamespace';

const ROLE_WITH_DETAILS_INCLUDE = {
  project: {
    select: {
      name: true,
    },
  },
  role_filters: {
    where: {
      archived: false,
    },
    include: {
      filter_companies: true,
      filter_location_cities: true,
    },
  },
  role_result: {
    include: {
      candidate: true,
    },
  },
} satisfies Prisma.rolesInclude;

type RoleWithDetails = Prisma.rolesGetPayload<{
  include: typeof ROLE_WITH_DETAILS_INCLUDE;
}>;

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectsService: ProjectsService,
  ) {}

  async findAllForProject(
    projectId: string,
    orgId: string,
    userId: string,
  ): Promise<roles[]> {
    await this.projectsService.findOneForUser(projectId, orgId, userId);
    return this.prisma.roles.findMany({ where: { project_id: projectId } });
  }

  async findOne(
    id: string,
    orgId: string,
    userId: string,
  ): Promise<RoleWithDetails> {
    const role = await this.prisma.roles.findFirst({
      where: { uid: id },
      include: ROLE_WITH_DETAILS_INCLUDE,
    });

    if (!role) {
      throw new RequestException(
        'Role not found',
        HttpStatus.NOT_FOUND,
        'ROLE_NOT_FOUND',
      );
    }

    await this.projectsService.findOneForUser(role.project_id, orgId, userId);
    return role;
  }

  async getRole(id: string, orgId: string, userId: string): Promise<roles> {
    const role = await this.findRoleOrThrow(id);
    await this.projectsService.findOneForUser(role.project_id, orgId, userId);
    return role;
  }

  async create(
    dto: CreateRoleDto,
    userId: string,
    orgId: string,
  ): Promise<roles> {
    await this.projectsService.findOneForUser(dto.project_id, orgId, userId);
    return this.prisma.roles.create({
      data: {
        project_id: dto.project_id,
        name: dto.name,
        description: dto.description,
        created_by: userId,
      },
    });
  }

  async createFilter(
    roleId: string,
    dto: RoleFilterDto,
    orgId: string,
    userId: string,
  ): Promise<
    role_filters & {
      filter_companies: Prisma.filter_companiesGetPayload<object>[];
      filter_location_cities: Prisma.filter_location_citiesGetPayload<object>[];
    }
  > {
    await this.getRole(roleId, orgId, userId);

    // Archive previous filters to mark them as archived, so we can keep a history of filters for the role.
    await this.prisma.role_filters.updateMany({
      where: {
        role_id: roleId,
      },
      data: {
        archived: true,
      },
    });

    return this.prisma.role_filters.create({
      data: {
        role_id: roleId,
        country_code: dto.country_code,
        remote_work: dto.remote_work,
        work_authorization_required: dto.work_authorization_required,
        experience_min_yrs: dto.experience_min_yrs,
        experience_max_yrs: dto.experience_max_yrs,
        title: dto.title,
        alternative_titles: dto.alternative_titles,
        title_levels: dto.title_levels,
        roles: dto.roles,
        current_role_min_yrs: dto.current_role_min_yrs,
        current_role_max_yrs: dto.current_role_max_yrs,
        current_role_tenure_yrs: dto.current_role_tenure_yrs,
        required_skills: dto.required_skills,
        optional_skills: dto.optional_skills,
        education_levels: dto.education_levels,
        education_universities: dto.education_universities,
        education_excluded_universities: dto.education_excluded_universities,
        education_graduation_min_yr: this.yearToDate(
          dto.education_graduation_min_yr,
        ),
        education_graduation_max_yr: this.yearToDate(
          dto.education_graduation_max_yr,
        ),
        required_languages: dto.required_languages,
        optional_languages: dto.optional_languages,
        career_growth: dto.career_growth,
        security_clearance_required: dto.security_clearance_required,
        diversity: dto.diversity,
        other_experience: dto.other_experience,
        sites: dto.sites,
        industry: dto.industry,
        metadata: dto.metadata as unknown as InputJsonValue,
        filter_companies: {
          create: dto.filter_companies.map((company) => ({
            type: company.type,
            company_names: company.company_names,
            start_date: company.start_date,
            end_date: company.end_date,
          })),
        },
        filter_location_cities: {
          create: dto.filter_location_cities.map((city) => ({
            name: city.name,
            state: city.state,
            country_code: city.country_code,
          })),
        },
      },
      include: {
        filter_companies: true,
        filter_location_cities: true,
      },
    });
  }

  // education_graduation_min_yr/max_yr are years (e.g. 2020) in RoleFilterDto
  // but DateTime? columns in role_filters — stored as Jan 1st UTC of that year.
  private yearToDate(year: number | null | undefined): Date | null {
    return year === null || year === undefined
      ? null
      : new Date(Date.UTC(year, 0, 1));
  }

  async update(
    id: string,
    dto: UpdateRoleDto,
    userId: string,
    orgId: string,
  ): Promise<roles> {
    const role = await this.findRoleOrThrow(id);
    await this.requireProjectOwner(role.project_id, userId, orgId, 'update');

    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;

    return this.prisma.roles.update({ where: { uid: id }, data });
  }

  async remove(id: string, userId: string, orgId: string): Promise<void> {
    const role = await this.findRoleOrThrow(id);
    await this.requireProjectOwner(role.project_id, userId, orgId, 'delete');

    await this.prisma.roles.delete({ where: { uid: id } });
  }

  async getRoleResult(resultId: string, organization_id: string) {
    const result = await this.prisma.role_result.findFirst({
      where: {
        uid: resultId,
        role: {
          project: {
            organization_id: organization_id,
          },
        },
      },
      include: {
        candidate: {
          include: {
            experience: true,
            education: true,
          },
        },
      },
    });

    if (!result) {
      throw new RequestException(
        'Role result not found',
        HttpStatus.NOT_FOUND,
        'ROLE_RESULT_NOT_FOUND',
      );
    }

    return result;
  }
  private async findRoleOrThrow(id: string): Promise<roles> {
    const role = await this.prisma.roles.findFirst({
      where: { uid: id },
    });

    if (!role) {
      throw new RequestException(
        'Role not found',
        HttpStatus.NOT_FOUND,
        'ROLE_NOT_FOUND',
      );
    }

    return role;
  }

  private async requireProjectOwner(
    projectId: string,
    userId: string,
    orgId: string,
    action: 'update' | 'delete',
  ): Promise<void> {
    const project = await this.projectsService.findOneForUser(
      projectId,
      orgId,
      userId,
    );

    if (project.user_id !== userId) {
      throw new RequestException(
        `Only the project owner can ${action} this role`,
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
      );
    }
  }
}
