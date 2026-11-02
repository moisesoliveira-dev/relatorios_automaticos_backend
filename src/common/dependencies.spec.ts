import {
  Controller,
  INestApplication,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import * as ExcelJS from 'exceljs';
import { join } from 'path';
import request from 'supertest';
import { importClassesFromDirectories } from 'typeorm/util/DirectoryExportedClassesLoader';

/**
 * Rede de segurança para bibliotecas atualizadas/forçadas por `overrides` (multer, glob, minimatch,
 * uuid): se uma atualização quebrar algo que o sistema usa de verdade, estes testes falham.
 */

@Controller('up')
class UploadController {
  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 1024 } })) // mesmo formato do upload do logo
  upload(@UploadedFile() file: Express.Multer.File) {
    return { name: file.originalname, mime: file.mimetype, size: file.size };
  }
}

describe('multer (upload do logo)', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [UploadController],
    }).compile();
    app = mod.createNestApplication();
    await app.init();
  });
  afterAll(() => app.close());

  it('recebe um arquivo multipart', async () => {
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
    const res = await request(app.getHttpServer())
      .post('/up')
      .attach('file', png, { filename: 'logo.png', contentType: 'image/png' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      name: 'logo.png',
      mime: 'image/png',
      size: png.length,
    });
  });

  it('recusa arquivo acima do limite', async () => {
    const res = await request(app.getHttpServer())
      .post('/up')
      .attach('file', Buffer.alloc(4096), 'grande.bin');
    expect(res.status).toBe(413);
  });
});

describe('exceljs (planilhas de relatório)', () => {
  it('gera um .xlsx (zip) e consegue ler de volta', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Ocorrências');
    ws.addRow(['Código', 'Cliente', 'Valor']);
    ws.addRow(['PV-001', 'João Ñandú', 1234.56]);
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());

    expect(buffer.subarray(0, 2).toString()).toBe('PK'); // assinatura de arquivo zip

    const back = new ExcelJS.Workbook();
    await back.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    const sheet = back.getWorksheet('Ocorrências')!;
    expect(sheet.getRow(2).getCell(2).value).toBe('João Ñandú');
    expect(sheet.getRow(2).getCell(3).value).toBeCloseTo(1234.56);
  });
});

describe('typeorm (carga das migrations por padrão de arquivos)', () => {
  it('encontra e carrega as migrations do projeto', async () => {
    const logger = {
      log: () => undefined,
      warn: () => undefined,
      logSchemaBuild: () => undefined,
    } as any;
    const classes = await importClassesFromDirectories(logger, [
      join(__dirname, '..', 'migrations', '*.ts'),
    ]);
    expect(classes.map((c: any) => c.name)).toEqual(
      expect.arrayContaining([
        'BaselineSchema1700000000000',
        'CreateChatbotTables1762000000000',
        'CreateChatbotInbox1762100000000',
      ]),
    );
  });
});
