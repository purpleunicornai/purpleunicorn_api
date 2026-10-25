import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/database/prisma.service';
import { GEMINI_MODEL, GeminiService } from '../services/gemini/gemini.service';
import { RequestException } from '../common/exception/core/ExceptionBase';
import { ImportJobSpecDto } from './dto/job-spec-import.dto';
import { PDFParse } from 'pdf-parse';
import * as mammoth from 'mammoth';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);

@Injectable()
export class JobSpecImportService {
  private readonly logger = new Logger(JobSpecImportService.name);
  private static readonly MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

  constructor(
    private readonly prisma: PrismaService,
    private readonly geminiService: GeminiService,
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
    const { items, tokensUsed } = await this.geminiService.parseJobSpec(text);

    return this.prisma.job_spec_import.create({
      data: {
        role_id: roleId,
        original_text: text,
        created_by: userName,
        created_by_id: userId,
        ai_model_used: GEMINI_MODEL,
        tokens_used: tokensUsed,
        role_filter_items: {
          create: items.map((item) => {
            let children = item.children ?? [];
            if (item.category === 'companies') {
              children = [
                {
                  title: 'company_type',
                  value: 'include',
                },
                {
                  title: 'start_date',
                  value: dayjs.utc().subtract(5, 'year').toISOString(),
                },
                {
                  title: 'end_date',
                  value: dayjs.utc().toISOString(),
                },
                {
                  title: 'include_dates',
                  boolean_value: true,
                },
              ];
            }
            if (item.category === 'education') {
              children = [
                {
                  title: 'use_institution',
                  boolean_value: false,
                },
                {
                  title: 'institutions',
                  list_value: [],
                  value: '',
                },
                {
                  title: 'type',
                  value: 'include',
                },
              ];
            }

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
