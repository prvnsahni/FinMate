import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager, Brackets, In } from 'typeorm';
import {
  Group,
  GroupMember,
  Expense,
  ExpenseSplit,
  User,
  AuditLog,
} from '@finmate/data-models';
import * as XLSX from 'xlsx';
import { createHash } from 'crypto';

export interface ImportErrorDetail {
  row: number;
  message: string;
}

export interface ParsedRow {
  date?: string | Date | number;
  title?: string;
  amount?: string | number;
  currency?: string;
  category?: string;
  payer_email?: string;
  split_type?: string;
  shares_data?: string;
  description?: string;
  transaction_type?: string;
}

@Injectable()
export class ImportService {
  constructor(
    @InjectRepository(Group)
    private readonly groupRepository: Repository<Group>,
    @InjectRepository(GroupMember)
    private readonly groupMemberRepository: Repository<GroupMember>,
    @InjectRepository(Expense)
    private readonly expenseRepository: Repository<Expense>,
    @InjectRepository(ExpenseSplit)
    private readonly expenseSplitRepository: Repository<ExpenseSplit>,
    @InjectRepository(AuditLog)
    private readonly auditLogRepository: Repository<AuditLog>,
    private readonly dataSource: DataSource,
  ) {}

  private getIpHash(ip?: string): string | undefined {
    if (!ip) return undefined;
    return createHash('sha256').update(ip).digest('hex');
  }

  private async writeAuditLog(opts: {
    actorUser: User;
    action: string;
    entityId: string;
    groupId?: string;
    metadata?: Record<string, unknown>;
    ip?: string;
    userAgent?: string;
  }): Promise<void> {
    try {
      const meta = { ...opts.metadata };
      if (opts.userAgent) {
        meta.userAgent = opts.userAgent;
      }
      await this.auditLogRepository.save(
        this.auditLogRepository.create({
          actorUser: opts.actorUser,
          action: opts.action,
          entityType: 'import',
          entityId: opts.entityId,
          scope: opts.groupId ? 'group' : 'personal',
          group: opts.groupId ? ({ id: opts.groupId } as Group) : undefined,
          metadataJson: meta,
          ipHash: this.getIpHash(opts.ip),
        }),
      );
    } catch {
      // Audit log failures should never block primary operations
    }
  }

  private roundHalfUp(val: number): number {
    return Math.round((val + Number.EPSILON) * 100) / 100;
  }

  async importExpenses(
    userId: string,
    groupId: string,
    file: Express.Multer.File,
    context?: { ip?: string; userAgent?: string },
  ): Promise<{
    successCount: number;
    errorCount: number;
    errors: ImportErrorDetail[];
  }> {
    if (!file || !file.buffer) {
      throw new BadRequestException('No file uploaded or file buffer is empty');
    }

    // Verify file mimetype/type
    const allowedMimeTypes = [
      'text/csv',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/octet-stream', // Fallback for some OS/browsers
    ];

    const fileExtension = file.originalname.split('.').pop()?.toLowerCase();
    const isCsv = fileExtension === 'csv' || file.mimetype === 'text/csv';
    const isXlsx =
      fileExtension === 'xlsx' ||
      file.mimetype ===
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

    if (!isCsv && !isXlsx) {
      throw new BadRequestException({
        errorCode: 'VAL_INVALID_FILE',
        message: 'Invalid file type. Only CSV and XLSX files are supported.',
      });
    }

    // Parse the file using xlsx
    let rows: ParsedRow[] = [];
    try {
      const workbook = XLSX.read(file.buffer, {
        type: 'buffer',
        cellDates: true,
      });
      if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
        throw new BadRequestException('The uploaded file has no sheets.');
      }
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      if (!worksheet) {
        throw new BadRequestException(
          'The first sheet in the uploaded file is empty or missing.',
        );
      }
      rows = XLSX.utils.sheet_to_json<ParsedRow>(worksheet, { defval: '' });
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      const err = error as Error;
      throw new BadRequestException({
        errorCode: 'VAL_INVALID_FILE',
        message: `Failed to parse file: ${err.message}`,
      });
    }

    if (rows.length === 0) {
      throw new BadRequestException(
        'The uploaded spreadsheet contains no data rows.',
      );
    }

    // Wrap execution inside a single database transaction rollback boundary
    const { successCount, errorCount, errors, callerUser, group } =
      await this.dataSource.transaction(async (manager: EntityManager) => {
        // 1. Validate Group
        const group = await manager.findOne(Group, {
          where: { id: groupId },
          relations: ['ownerUser'],
        });
        if (!group) {
          throw new NotFoundException('Group not found');
        }
        if (group.isArchived) {
          throw new ForbiddenException({
            errorCode: 'RES_FORBIDDEN',
            message: 'Group is archived and read-only',
          });
        }

        // 2. Validate Caller membership and write permissions
        const callerMember = await manager.findOne(GroupMember, {
          where: {
            group: { id: groupId },
            user: { id: userId },
            joinStatus: 'active',
          },
        });
        if (!callerMember) {
          throw new ForbiddenException('You do not have access to this group');
        }
        if (callerMember.role === 'viewer') {
          throw new ForbiddenException({
            errorCode: 'RES_FORBIDDEN',
            message: 'Viewers do not have permission to import expenses',
          });
        }

        // 3. Get Active Members of the group to validate emails
        const activeMembers = await manager.find(GroupMember, {
          where: { group: { id: groupId }, joinStatus: 'active' },
          relations: ['user'],
        });

        // A Contact-backed member has no `user` (and no email) — guard against
        // it so a group containing any pending Contact member cannot NPE the
        // import. Contact-backed members simply aren't valid import payers/
        // participants (import references registered members only).
        const registeredMembers = activeMembers.filter(
          (m): m is typeof m & { user: User } => !!m.user,
        );
        const emailToUserMap = new Map<string, User>(
          registeredMembers.map((m) => [m.user.email.toLowerCase(), m.user]),
        );

        const validationErrors: { field: string; issue: string }[] = [];

        // Helper to push error
        const addError = (rowNum: number, field: string, issue: string) => {
          validationErrors.push({
            field: `Row ${rowNum}: ${field}`,
            issue,
          });
        };

        // 4. Validate all rows before committing anything
        const validatedRowsData: Array<{
          date: string;
          title: string;
          amount: number;
          currency: string;
          category: string;
          payerUser: User;
          splitType: 'equal' | 'fixed' | 'percent' | 'share';
          splits: Array<{ email: string; user: User; value: number }>;
          description?: string;
          transactionType: 'expense' | 'refund';
        }> = [];

        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          const rowNum = i + 2; // Row 1 is header, data starts at Row 2

          // Date validation
          const rawDate = row.date;
          let dateStr = '';
          if (rawDate instanceof Date) {
            const y = rawDate.getUTCFullYear();
            const m = String(rawDate.getUTCMonth() + 1).padStart(2, '0');
            const d = String(rawDate.getUTCDate()).padStart(2, '0');
            dateStr = `${y}-${m}-${d}`;
          } else {
            dateStr = String(rawDate || '').trim();
          }

          if (!dateStr) {
            addError(rowNum, 'date', 'Date is required');
          } else {
            const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
            if (!dateRegex.test(dateStr)) {
              addError(rowNum, 'date', 'Date must match YYYY-MM-DD format');
            } else {
              const parsedDate = new Date(dateStr);
              if (isNaN(parsedDate.getTime())) {
                addError(rowNum, 'date', 'Invalid calendar date');
              } else {
                const todayStr = new Date().toISOString().split('T')[0];
                if (dateStr > todayStr) {
                  addError(rowNum, 'date', 'Date cannot be in the future');
                }
              }
            }
          }

          // Title validation
          const titleStr = String(row.title || '').trim();
          if (!titleStr) {
            addError(rowNum, 'title', 'Title is required');
          } else if (titleStr.length > 160) {
            addError(rowNum, 'title', 'Title cannot exceed 160 characters');
          }

          // Amount validation
          const amountVal = row.amount;
          let amountNum = 0;
          if (
            amountVal === undefined ||
            amountVal === null ||
            String(amountVal).trim() === ''
          ) {
            addError(rowNum, 'amount', 'Amount is required');
          } else {
            amountNum = Number(amountVal);
            if (isNaN(amountNum) || amountNum <= 0) {
              addError(
                rowNum,
                'amount',
                'Amount must be a positive decimal number greater than 0',
              );
            } else {
              const amountStr = String(amountVal).trim();
              const decimalPart = amountStr.split('.')[1];
              if (decimalPart && decimalPart.length > 2) {
                addError(
                  rowNum,
                  'amount',
                  'Amount cannot exceed 2 decimal places',
                );
              }
            }
          }

          // Currency validation
          const currencyStr = String(row.currency || '')
            .trim()
            .toUpperCase();
          if (!currencyStr) {
            addError(rowNum, 'currency', 'Currency code is required');
          } else if (!/^[A-Z]{3}$/.test(currencyStr)) {
            addError(
              rowNum,
              'currency',
              'Currency must be exactly 3 uppercase letters (ISO 4217)',
            );
          }

          // Category validation
          const categoryStr = String(row.category || '').trim();
          if (!categoryStr) {
            addError(rowNum, 'category', 'Category is required');
          } else if (categoryStr.length > 64) {
            addError(
              rowNum,
              'category',
              'Category cannot exceed 64 characters',
            );
          }

          // Transaction type validation (optional; defaults to `expense` so
          // legacy files without the column keep importing as normal expenses).
          const transactionTypeStr = String(row.transaction_type || 'expense')
            .trim()
            .toLowerCase();
          if (
            transactionTypeStr !== 'expense' &&
            transactionTypeStr !== 'refund'
          ) {
            addError(
              rowNum,
              'transaction_type',
              "Transaction type must be 'expense' or 'refund'",
            );
          }

          // Payer email validation
          const payerEmail = String(row.payer_email || '')
            .trim()
            .toLowerCase();
          let payerUser: User | undefined;
          if (!payerEmail) {
            addError(rowNum, 'payer_email', 'Payer email is required');
          } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payerEmail)) {
            addError(rowNum, 'payer_email', 'Invalid email format');
          } else {
            payerUser = emailToUserMap.get(payerEmail);
            if (!payerUser) {
              addError(
                rowNum,
                'payer_email',
                `User '${row.payer_email}' is not a member of the group.`,
              );
            }
          }

          // Split type validation
          const splitTypeStr = String(row.split_type || '')
            .trim()
            .toLowerCase();
          if (!splitTypeStr) {
            addError(rowNum, 'split_type', 'Split type is required');
          } else if (
            !['equal', 'fixed', 'percent', 'share'].includes(splitTypeStr)
          ) {
            addError(
              rowNum,
              'split_type',
              'Invalid split type. Must be equal, fixed, percent, or share',
            );
          }

          // Parse and validate shares_data
          const splitType = splitTypeStr as
            | 'equal'
            | 'fixed'
            | 'percent'
            | 'share';
          const sharesDataStr = String(row.shares_data || '').trim();
          const parsedSplits: Array<{
            email: string;
            user: User;
            value: number;
          }> = [];

          if (!sharesDataStr) {
            if (splitType === 'equal') {
              // Default to equal split among all active group members
              activeMembers.forEach((m) => {
                if (m.user?.email) {
                  parsedSplits.push({
                    email: m.user.email.toLowerCase(),
                    user: m.user,
                    value: 1.0, // weight = 1
                  });
                }
              });
            } else {
              addError(
                rowNum,
                'shares_data',
                `Shares data is required for split type '${splitType}'`,
              );
            }
          } else {
            const parts = sharesDataStr
              .split(';')
              .map((p) => p.trim())
              .filter(Boolean);
            const seenEmails = new Set<string>();

            for (const part of parts) {
              const separatorIndex = part.indexOf(':');
              if (separatorIndex === -1) {
                addError(
                  rowNum,
                  'shares_data',
                  `Invalid format for '${part}'. Must be email:value`,
                );
                continue;
              }

              const email = part
                .substring(0, separatorIndex)
                .trim()
                .toLowerCase();
              const valStr = part.substring(separatorIndex + 1).trim();

              if (!email) {
                addError(
                  rowNum,
                  'shares_data',
                  'Missing email in shares entry',
                );
                continue;
              }

              if (seenEmails.has(email)) {
                addError(
                  rowNum,
                  'shares_data',
                  `Duplicate split entry for email '${email}'`,
                );
                continue;
              }
              seenEmails.add(email);

              const user = emailToUserMap.get(email);
              if (!user) {
                addError(
                  rowNum,
                  'shares_data',
                  `User '${email}' in shares data is not an active member of the group`,
                );
                continue;
              }

              const val = Number(valStr);
              if (isNaN(val) || val <= 0) {
                addError(
                  rowNum,
                  'shares_data',
                  `Value for '${email}' must be a positive decimal number`,
                );
                continue;
              }

              parsedSplits.push({ email, user, value: val });
            }

            // Sum and mathematical checks
            if (
              parsedSplits.length > 0 &&
              validationErrors.filter((e) =>
                e.field.startsWith(`Row ${rowNum}:`),
              ).length === 0
            ) {
              const sum = parsedSplits.reduce((acc, s) => acc + s.value, 0);
              if (splitType === 'fixed') {
                // Sum must equal total amount
                if (Math.abs(sum - amountNum) >= 0.005) {
                  addError(
                    rowNum,
                    'shares_data',
                    `Fixed split amounts sum up to $${this.roundHalfUp(sum).toFixed(2)}, but amount is $${amountNum.toFixed(2)}.`,
                  );
                }
              } else if (splitType === 'percent') {
                // Sum must equal 100.00
                if (Math.abs(sum - 100.0) >= 0.005) {
                  addError(
                    rowNum,
                    'shares_data',
                    `Percentage split values must sum up to exactly 100.00 (got ${sum.toFixed(2)})`,
                  );
                }
              }
            }
          }

          if (
            validationErrors.filter((e) => e.field.startsWith(`Row ${rowNum}:`))
              .length === 0 &&
            payerUser
          ) {
            validatedRowsData.push({
              date: dateStr,
              title: titleStr,
              amount: amountNum,
              currency: currencyStr,
              category: categoryStr,
              payerUser,
              splitType,
              splits: parsedSplits,
              description: row.description
                ? String(row.description).trim()
                : undefined,
              transactionType: transactionTypeStr as 'expense' | 'refund',
            });
          }
        }

        // If any validation fails, reject the entire import and roll back
        if (validationErrors.length > 0) {
          throw new BadRequestException({
            errorCode: 'VAL_INVALID_INPUT',
            message: 'File validation failed. No transactions were imported.',
            details: validationErrors,
          });
        }

        // 5. Save everything inside the transaction boundary
        const callerUser = await manager.findOne(User, {
          where: { id: userId },
        });
        if (!callerUser) {
          throw new NotFoundException('Caller user not found');
        }

        for (const rowData of validatedRowsData) {
          // Create Expense
          const expense = manager.create(Expense, {
            title: rowData.title,
            description: rowData.description,
            amountTotal: rowData.amount,
            currency: rowData.currency,
            category: rowData.category,
            paidByUser: rowData.payerUser,
            ownerUser: callerUser,
            group: group,
            expenseDate: rowData.date,
            status: 'posted',
            transactionType: rowData.transactionType,
          });

          const savedExpense = await manager.save(Expense, expense);

          // Compute split owed amounts
          let calculatedSplits: Array<{
            participantUser: User;
            shareValue: number;
            amountOwed: number;
          }> = [];

          if (rowData.splitType === 'fixed') {
            calculatedSplits = rowData.splits.map((s) => ({
              participantUser: s.user,
              shareValue: s.value,
              amountOwed: this.roundHalfUp(s.value),
            }));
          } else {
            // equal, percent, share splits
            const totalWeight =
              rowData.splitType === 'equal'
                ? rowData.splits.length
                : rowData.splitType === 'percent'
                  ? 100.0
                  : rowData.splits.reduce((acc, s) => acc + s.value, 0);

            let sumOwed = 0;
            const initialSplits = rowData.splits.map((s) => {
              const calculated = rowData.amount * (s.value / totalWeight);
              const amountOwed = this.roundHalfUp(calculated);
              sumOwed += amountOwed;
              return {
                participantUser: s.user,
                shareValue: s.value,
                amountOwed,
              };
            });

            // Check for rounding remainder
            const remainder = this.roundHalfUp(rowData.amount - sumOwed);
            if (remainder !== 0) {
              // Allocate to payer if in the split list, otherwise lexicographically smallest UUID user
              const payerSplit = initialSplits.find(
                (s) => s.participantUser.id === rowData.payerUser.id,
              );
              if (payerSplit) {
                payerSplit.amountOwed = this.roundHalfUp(
                  payerSplit.amountOwed + remainder,
                );
              } else {
                const sorted = [...initialSplits].sort((a, b) =>
                  a.participantUser.id.localeCompare(b.participantUser.id),
                );
                if (sorted[0]) {
                  sorted[0].amountOwed = this.roundHalfUp(
                    sorted[0].amountOwed + remainder,
                  );
                }
              }
            }

            calculatedSplits = initialSplits;
          }

          // Save ExpenseSplits
          for (const splitData of calculatedSplits) {
            const split = manager.create(ExpenseSplit, {
              expense: savedExpense,
              participantUser: splitData.participantUser,
              splitType: rowData.splitType,
              shareValue: splitData.shareValue,
              amountOwed: splitData.amountOwed,
              isSettled: false,
            });
            await manager.save(ExpenseSplit, split);
          }
        }

        return {
          successCount: validatedRowsData.length,
          errorCount: 0,
          errors: [],
          callerUser,
          group,
        };
      });

    void this.writeAuditLog({
      actorUser: callerUser,
      action: 'group.expenses_imported',
      entityId: group.id,
      groupId: group.id,
      metadata: {
        successCount,
        filename: file.originalname,
        fileSize: file.size,
      },
      ip: context?.ip,
      userAgent: context?.userAgent,
    });

    return { successCount, errorCount, errors };
  }

  async exportExpenses(
    userId: string,
    format: 'csv' | 'xlsx',
    groupId?: string,
    startDate?: string,
    endDate?: string,
  ): Promise<{ buffer: Buffer; mimeType: string; filename: string }> {
    // 1. Validate date filters format if provided
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (startDate && !dateRegex.test(startDate)) {
      throw new BadRequestException('startDate must match YYYY-MM-DD format');
    }
    if (endDate && !dateRegex.test(endDate)) {
      throw new BadRequestException('endDate must match YYYY-MM-DD format');
    }

    let groupIds: string[] = [];

    if (groupId) {
      // Validate Group exists and caller is active member
      const group = await this.groupRepository.findOne({
        where: { id: groupId },
      });
      if (!group) {
        throw new NotFoundException('Group not found');
      }

      const callerMember = await this.groupMemberRepository.findOne({
        where: {
          group: { id: groupId },
          user: { id: userId },
          joinStatus: 'active',
        },
      });
      if (!callerMember) {
        throw new ForbiddenException('You do not have access to this group');
      }
    } else {
      // Find all groups caller is active member of
      const memberships = await this.groupMemberRepository.find({
        where: { user: { id: userId }, joinStatus: 'active' },
        relations: ['group'],
      });
      groupIds = memberships.map((m) => m.group.id);
    }

    // 2. Query expenses with splits
    // 2. Query expenses
    const query = this.expenseRepository
      .createQueryBuilder('expense')
      .leftJoinAndSelect('expense.paidByUser', 'paidByUser')
      .leftJoinAndSelect('expense.group', 'group')
      .leftJoinAndSelect('expense.ownerUser', 'ownerUser');

    if (groupId) {
      query.andWhere('group.id = :groupId', { groupId });
    } else {
      if (groupIds.length > 0) {
        query.andWhere(
          new Brackets((qb) => {
            qb.where('group.id IN (:...groupIds)', { groupIds }).orWhere(
              'group.id IS NULL AND ownerUser.id = :userId',
              { userId },
            );
          }),
        );
      } else {
        query.andWhere('group.id IS NULL AND ownerUser.id = :userId', {
          userId,
        });
      }
    }

    if (startDate) {
      query.andWhere('expense.expenseDate >= :startDate', { startDate });
    }
    if (endDate) {
      query.andWhere('expense.expenseDate <= :endDate', { endDate });
    }

    query
      .orderBy('expense.expenseDate', 'ASC')
      .addOrderBy('expense.createdAt', 'ASC');

    const expenses = await query.getMany();

    // Query splits for these expenses to avoid circular dependency in entities
    const splitsMap = new Map<string, ExpenseSplit[]>();
    if (expenses.length > 0) {
      const expenseIds = expenses.map((e) => e.id);
      const allSplits = await this.expenseSplitRepository.find({
        where: { expense: { id: In(expenseIds) } },
        relations: ['participantUser', 'expense'],
      });

      for (const split of allSplits) {
        const expId = split.expense.id;
        if (!splitsMap.has(expId)) {
          splitsMap.set(expId, []);
        }
        splitsMap.get(expId)!.push(split);
      }
    }

    // 3. Format into layout structure matching the import schema
    const exportData = expenses.map((expense) => {
      const splits = splitsMap.get(expense.id) || [];
      const sharesData = splits
        .filter((s) => s.participantUser?.email)
        .map(
          (s) =>
            `${s.participantUser!.email.toLowerCase()}:${Number(s.shareValue)}`,
        )
        .sort()
        .join(';');

      const dateVal = expense.expenseDate as unknown;
      let dateStr = '';
      if (dateVal instanceof Date) {
        const y = dateVal.getUTCFullYear();
        const m = String(dateVal.getUTCMonth() + 1).padStart(2, '0');
        const d = String(dateVal.getUTCDate()).padStart(2, '0');
        dateStr = `${y}-${m}-${d}`;
      } else {
        dateStr = String(dateVal || '');
      }

      return {
        date: dateStr,
        title: expense.title,
        amount: Number(expense.amountTotal).toFixed(2),
        currency: expense.currency.toUpperCase(),
        category: expense.category,
        transaction_type: expense.transactionType ?? 'expense',
        payer_email: expense.paidByUser?.email?.toLowerCase() || '',
        split_type: splits[0]?.splitType || 'equal',
        shares_data: sharesData,
        description: expense.description || '',
      };
    });

    // 4. Generate worksheet
    const worksheet = XLSX.utils.json_to_sheet(exportData, {
      header: [
        'date',
        'title',
        'amount',
        'currency',
        'category',
        'transaction_type',
        'payer_email',
        'split_type',
        'shares_data',
        'description',
      ],
    });

    let buffer: Buffer;
    let mimeType: string;
    let filename: string;
    const timestamp = Date.now();

    if (format === 'xlsx') {
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Expenses');
      buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
      mimeType =
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      filename = `expenses_export_${timestamp}.xlsx`;
    } else {
      const csvContent = XLSX.utils.sheet_to_csv(worksheet);
      buffer = Buffer.from(csvContent, 'utf-8');
      mimeType = 'text/csv';
      filename = `expenses_export_${timestamp}.csv`;
    }

    return { buffer, mimeType, filename };
  }
}
