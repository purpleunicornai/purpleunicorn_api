import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/database/prisma.service';
import { ReasoningService } from '../services/reasoning/reasoning.service';
import { RequestException } from '../common/exception/core/ExceptionBase';
import { ImportJobSpecDto } from './dto/job-spec-import.dto';
import type { GeminiJobSpecFilterItem } from '../services/gemini/gemini.service';
import {
  WORK_TYPES_CHILD,
  withWorkTypeChildren,
  workTypesFromChildren,
} from './search/work-types';
// Must stay before the 'pdf-parse' import below — it defines DOMMatrix/
// Path2D/ImageData on globalThis before pdf-parse's module-top-level code
// runs and crashes without them. See pdf-dom-polyfills.ts for why.
import '../common/utils/pdf-dom-polyfills';
import { PDFParse } from 'pdf-parse';
import * as mammoth from 'mammoth';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);

// pdf-parse's "fake worker" (its Node fallback for a real Worker thread)
// loads pdf.worker.mjs via a dynamically-constructed path at request time,
// invisible to Vercel's build-time file tracer — so the file silently gets
// dropped from the deployed function and that load fails in production
// with "Cannot find module .../pdf.worker.mjs". A literal, statically-
// resolvable require.resolve() call here is enough for the tracer to pick
// the file up and include it, regardless of which file Vercel treats as
// the actual serverless entrypoint. Wrapped in try/catch since Jest's
// resolver doesn't resolve .mjs subpaths the way Node's real require does
// (irrelevant to the tracer, which works via static analysis, not
// execution) — the resolved path itself is never actually used.
try {
  require.resolve('pdf-parse/dist/pdf-parse/cjs/pdf.worker.mjs');
} catch {
  // Resolution failing here (e.g. under Jest) has no effect on Vercel's
  // build-time tracing — see comment above.
}

type ImportedChild = NonNullable<GeminiJobSpecFilterItem['children']>[number];

const childOf = (item: GeminiJobSpecFilterItem, title: string) =>
  item.children?.find((child) => child.title === title);

// Fills in the children the filter UI expects for companies and education,
// keeping what the AI actually read from the spec (include vs exclude, the
// named institutions) instead of overwriting it with defaults. Location rows
// get a work_types child, with remote_work kept in sync.
export function importedChildren(
  item: GeminiJobSpecFilterItem,
): ImportedChild[] {
  if (item.category === 'companies') {
    const type = childOf(item, 'company_type')?.value;
    return [
      {
        title: 'company_type',
        value: type === 'exclude' || type === 'current' ? type : 'include',
      },
      {
        title: 'start_date',
        value: dayjs.utc().subtract(5, 'year').toISOString(),
      },
      { title: 'end_date', value: dayjs.utc().toISOString() },
      { title: 'include_dates', boolean_value: true },
    ];
  }
  if (item.category === 'education') {
    const institutions = (
      childOf(item, 'institutions')?.list_value ?? []
    ).filter((name) => name.trim());
    const type = childOf(item, 'type')?.value;
    return [
      { title: 'use_institution', boolean_value: institutions.length > 0 },
      { title: 'institutions', list_value: institutions, value: '' },
      { title: 'type', value: type === 'exclude' ? 'exclude' : 'include' },
    ];
  }
  if (item.category === 'location') {
    const children = item.children ?? [];
    const hasWorkInfo = children.some(
      (child) =>
        child.title === WORK_TYPES_CHILD || child.title === 'remote_work',
    );
    return hasWorkInfo
      ? withWorkTypeChildren(children, workTypesFromChildren(children))
      : children;
  }
  return item.children ?? [];
}

@Injectable()
export class JobSpecImportService {
  private readonly logger = new Logger(JobSpecImportService.name);
  private static readonly MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

  constructor(
    private readonly prisma: PrismaService,
    private readonly reasoningService: ReasoningService,
  ) {}

  // Persists the AI's output as real role_filter_item/role_filter_child
  // rows linked to the job_spec_import (not yet to the role's own
  // role_filters) so the recruiter can review/edit them before they're ever
  // saved as this role's actual filters.
  async importJobSpec(
    roleId: string,
    dto: ImportJobSpecDto,
    userId: string,
    userName: string,
  ) {
    const text = await this.resolveText(dto);
    const ai = await this.reasoningService.forRole(roleId);
    const { items, tokensUsed } = await ai.provider.parseJobSpec(text, {
      model: ai.model,
    });

    return this.prisma.job_spec_import.create({
      data: {
        role_id: roleId,
        original_text: text,
        created_by: userName,
        created_by_id: userId,
        ai_model_used: ai.model,
        tokens_used: tokensUsed,
        role_filter_items: {
          create: items.map((item) => {
            const children = importedChildren(item);
            return {
              category: item.category,
              value: item.value,
              list_value: item.list_value ?? [],
              priority: item.priority,
              non_negotiable: item.non_negotiable ?? false,
              children: {
                create: children.map((child) => ({
                  title: child.title,
                  value: child.value,
                  list_value: child.list_value ?? [],
                  boolean: child.boolean_value ?? false,
                })),
              },
            };
          }),
        },
      },
      include: { role_filter_items: { include: { children: true } } },
    });
  }

  // "Generate from brief": the latest imported brief or job spec, or failing
  // that the role's current filters, written up as a description to review.
  async describeRole(roleId: string): Promise<{ description: string }> {
    const role = await this.prisma.roles.findUniqueOrThrow({
      where: { uid: roleId },
      select: {
        name: true,
        job_spec_import: {
          where: { original_text: { not: null } },
          orderBy: { created: 'desc' },
          take: 1,
          select: { original_text: true },
        },
        role_filters: {
          where: { archived: false },
          select: {
            role_filter_items: {
              select: { category: true, value: true, list_value: true },
            },
          },
        },
      },
    });
    const filterLines = role.role_filters
      .flatMap((f) => f.role_filter_items)
      .map(
        (i) =>
          `${i.category}: ${[i.value, ...i.list_value].filter(Boolean).join(', ')}`,
      );
    const brief =
      role.job_spec_import[0]?.original_text?.trim() || filterLines.join('\n');
    if (!brief) {
      throw new RequestException(
        'Add a brief or filters first, then generate a description from them',
        HttpStatus.UNPROCESSABLE_ENTITY,
        'ROLE_BRIEF_MISSING',
      );
    }

    const ai = await this.reasoningService.forRole(roleId);
    const { description } = await ai.provider.describeRole(
      { roleName: role.name, brief },
      { model: ai.model },
    );
    return { description };
  }

  // Pasted text always wins over an uploaded file when both are somehow
  // present — simpler than rejecting the request outright, and pasted text
  // is the more direct, lossless signal of the two.
  private async resolveText(dto: ImportJobSpecDto): Promise<string> {
    if (dto.text) return dto.text;

    if (!dto.file_base64) {
      throw new RequestException(
        'Either text or file_base64 must be provided',
        HttpStatus.BAD_REQUEST,
        'JOB_SPEC_INPUT_REQUIRED',
      );
    }

    const buffer = Buffer.from(dto.file_base64, 'base64');
    if (buffer.length > JobSpecImportService.MAX_FILE_SIZE_BYTES) {
      throw new RequestException(
        'File exceeds the maximum allowed size of 5MB',
        HttpStatus.BAD_REQUEST,
        'FILE_TOO_LARGE',
      );
    }
    const extension = dto.file_name?.split('.').pop()?.toLowerCase();

    switch (extension) {
      case 'pdf':
        return this.extractPdfText(buffer);
      case 'docx': {
        const result = await mammoth.extractRawText({ buffer });
        return result.value;
      }
      case 'txt':
        return buffer.toString('utf-8');
      default:
        throw new RequestException(
          `Unsupported file type: ${extension ?? 'unknown'}`,
          HttpStatus.BAD_REQUEST,
          'UNSUPPORTED_FILE_TYPE',
        );
    }
  }

  private async extractPdfText(buffer: Buffer): Promise<string> {
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      return result.text;
    } finally {
      await parser.destroy();
    }
  }
}
