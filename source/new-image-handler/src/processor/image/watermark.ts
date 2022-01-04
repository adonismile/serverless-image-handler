import * as sharp from 'sharp';
import { IImageAction, IImageContext } from '.';
import { IActionOpts, ReadOnly, InvalidArgument } from '..';
const margin = 5;

export interface WatermarkOpts extends IActionOpts {
  text: string;
  t: number; // 不透明度
  g: string; // 位置
  fill: boolean; // 文字是否重复
  rotate: number; // 文字旋转角度
  size: number; // 文字大小
  color: string; // 文字颜色
  image: string; // img 水印URL
  auto: boolean; // 自动调整水印图片大小以适应背景
  x?: number; // 图文水印的x位置
  y?: number; // 图文水印的y位置
  voffset: number; // 图文水印的居中时候的偏移位置
  order: number; // 图文混排中，文字图片的先后顺序
  interval: number; // 图文混排中，图片和文字间隔
  align: number; // 图文混排中，图片和文字对其方式

}

interface WatermarkTextOpts extends IActionOpts {
  width: number;
  height: number;
}

interface WatermarkImgOpts extends IActionOpts {
  x?: number;
  y?: number;
}

interface WatermarkMixedGravityOpts extends IActionOpts {
  imgGravity: string;
  textGravity: string;
}

export class WatermarkAction implements IImageAction {
  public readonly name: string = 'watermark';

  public validate(params: string[]): ReadOnly<WatermarkOpts> {
    let opt: WatermarkOpts = { text: '', t: 100, g: 'se', fill: false, rotate: 0, size: 40, color: '000000', image: '', auto: true, order: 0, x: undefined, y: undefined, voffset: 0, interval: 0, align: 0 };

    for (const param of params) {
      if ((this.name === param) || (!param)) {
        continue;
      }
      const [k, v] = param.split('_');
      if (k === 'text') {
        if (v) {
          const buff = Buffer.from(v, 'base64');
          opt.text = buff.toString('utf-8');
        }
      } else if (k === 'image') {
        if (v) {
          const buff = Buffer.from(v, 'base64');
          opt.image = buff.toString('utf-8');
        }
      } else if (k === 't') {
        opt.t = Number.parseInt(v, 10);
      } else if (k === 'x') {
        opt.x = Number.parseInt(v, 10);
        if (opt.x < 0 || opt.x > 4096) {
          throw new InvalidArgument('Watermark param \'x\' must be between 0 and 4096');
        }
      } else if (k === 'y') {
        opt.y = Number.parseInt(v, 10);
        if (opt.y < 0 || opt.y > 4096) {
          throw new InvalidArgument('Watermark param \'y\' must be between 0 and 4096');
        }
      } else if (k === 'voffset') {
        opt.voffset = Number.parseInt(v, 10);
        if (opt.voffset < -1000 || opt.voffset > 1000) {
          throw new InvalidArgument('Watermark param \'voffset\' must be between -1000 and 1000');
        }
      } else if (k === 'order') {
        opt.order = Number.parseInt(v, 10);
      } else if (k === 'interval') {
        opt.interval = Number.parseInt(v, 10);
        if (opt.interval < 0 || opt.interval > 1000) {
          throw new InvalidArgument('Watermark param \'interval\' must be between 0 and 1000');
        }
      } else if (k === 'align') {
        opt.align = Number.parseInt(v, 10);
      } else if (k === 'g') {
        opt.g = this.gravityConvert(v);
      } else if (k === 'size') {
        const size = Number.parseInt(v, 10);
        opt.size = size;
        if (opt.size < 0 || opt.size > 1000) {
          throw new InvalidArgument('Watermark param \'size\' must be between 0 and 4096');
        }
      } else if (k === 'fill') {
        if (v && (v === '0' || v === '1')) {
          opt.fill = (v === '1');
        } else {
          throw new InvalidArgument('Watermark param \'fill\' must be 0 or 1');
        }
      } else if (k === 'auto') {
        if (v && (v === '0' || v === '1')) {
          opt.auto = (v === '1');
        } else {
          throw new InvalidArgument('Watermark param \'auto\' must be 0 or 1');
        }
      } else if (k === 'rotate') {
        const rotate = Number.parseInt(v, 10);
        if (0 <= rotate && 360 >= rotate) {
          if (rotate === 360) {
            opt.rotate = 0;
          } else {
            opt.rotate = rotate;
          }
        } else {
          throw new InvalidArgument('Watermark param \'rotate\' must be between 0 and 360');
        }

      } else if (k === 'color') {
        opt.color = v;
      } else {
        throw new InvalidArgument(`Unkown param: "${k}"`);
      }
    }
    if (!opt.text && !opt.image) {
      throw new InvalidArgument('Watermark param \'text\' and \'image\' should not be empty at the same time');
    }

    return opt;
  }


  public async process(ctx: IImageContext, params: string[]): Promise<void> {
    const opt = this.validate(params);
    if (opt.text && opt.image) {
      await this.mixedWaterMark(ctx, opt);
    } else if (opt.text) {
      await this.textWaterMark(ctx, opt);
    } else {
      await this.imgWaterMark(ctx, opt);
    }
  }

  async textWaterMark(ctx: IImageContext, opt: WatermarkOpts): Promise<void> {
    const textOpt = this.calculateTextSize(opt.text, opt.size);
    const svg = this.textSvgStr(opt, textOpt);
    const svgBytes = Buffer.from(svg);

    if (0 < opt.rotate) {
      // hard to rotate the svg directly, so attach it on image, then rotate the image
      const overlapImg = this.textSvgImg(svgBytes, textOpt);

      const overlapImgBuffer = await overlapImg.png().toBuffer();
      let optOverlapImg = sharp(overlapImgBuffer).png();
      if (0 < opt.rotate) {
        optOverlapImg = optOverlapImg.rotate(opt.rotate, { background: '#00000000' });
      }

      optOverlapImg = await this.autoResizeImg(optOverlapImg, ctx, opt, textOpt);

      const rotateOverlabImgBuffer = await optOverlapImg.toBuffer();
      ctx.image.composite([{ input: rotateOverlabImgBuffer, tile: opt.fill, gravity: opt.g }]);
    } else {
      const bt = await this.autoResizeSvg(svgBytes, ctx, opt, textOpt);
      ctx.image.composite([{ input: bt, tile: opt.fill, gravity: opt.g }]);
    }
  }

  async imgWaterMark(ctx: IImageContext, opt: WatermarkOpts): Promise<void> {
    const bs = ctx.bufferStore;

    const watermarkImgBuffer = (await bs.get(opt.image)).buffer;
    let watermarkImg = sharp(watermarkImgBuffer).png();

    if (0 < opt.rotate) {
      watermarkImg = sharp(await watermarkImg.toBuffer());
      const bt = await watermarkImg.rotate(opt.rotate, { background: '#ffffff' }).toBuffer();
      watermarkImg = sharp(bt);
    }
    // auto scale warkmark size
    const metadata = await ctx.image.metadata();
    const markMetadata = await watermarkImg.metadata();
    if (opt.auto) {
      // check the warkmark image size, if bigger than backgroud image, need resize the overlay
      let width = markMetadata.width;
      let height = markMetadata.height;
      let needResize = false;

      if (markMetadata.width && metadata.width && markMetadata.width > metadata.width) {
        width = metadata.width - 1;
        needResize = true;
      }

      if (markMetadata.height && metadata.height && markMetadata.height > metadata.height) {
        height = metadata.height - 1;
        needResize = true;
      }
      if (needResize) {
        watermarkImg = watermarkImg.resize(width, height);
      }
    }
    const pos = this.calculateImgPos(opt, metadata, markMetadata);
    const bt = await watermarkImg.toBuffer();
    const overlay: sharp.OverlayOptions = { input: bt, tile: opt.fill, gravity: opt.g, top: pos.y, left: pos.x };
    if (opt.t < 100 && markMetadata.hasAlpha) {
      const overForPng = sharp(await ctx.image.toBuffer()).png();
      const overBuffer = await overForPng.composite([overlay]).removeAlpha().ensureAlpha(opt.t / 100).toBuffer();
      const overlay2: sharp.OverlayOptions = { input: overBuffer };
      ctx.image.composite([overlay2]);
    } else {
      ctx.image.composite([overlay]);
    }
  }

  async mixedWaterMark(ctx: IImageContext, opt: WatermarkOpts): Promise<void> {
    const bs = ctx.bufferStore;
    const textOpt = this.calculateTextSize(opt.text, opt.size);
    const svg = this.textSvgStr(opt, textOpt, false);
    const svgBytes = Buffer.from(svg);

    const watermarkImgBuffer = (await bs.get(opt.image)).buffer;
    const watermarkImg = sharp(watermarkImgBuffer).png();
    const imgMetadata = await watermarkImg.metadata();
    const imgW = imgMetadata.width ? imgMetadata.width : 0;
    const imgH = imgMetadata.height ? imgMetadata.height : 0;
    const gravityOpt = this.calculateMixedGravity(opt);
    const wbt = await watermarkImg.toBuffer();

    const backMetadata = await ctx.image.metadata();

    const expectedWidth = textOpt.width + imgW + opt.interval;
    const expectedHeight = Math.max(textOpt.height, imgH);

    let overlapImg = sharp({
      create: {
        width: expectedWidth,
        height: expectedHeight,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    }).composite([{ input: svgBytes, gravity: gravityOpt.textGravity }, { input: wbt, gravity: gravityOpt.imgGravity }]);
    let alWidth = expectedWidth;
    let alHeight = expectedHeight;
    let needResize = false;
    if (backMetadata.width && expectedWidth > backMetadata.width) {
      alWidth = Math.min(expectedWidth, backMetadata.width) - 1;
      needResize = true;
    }
    if (backMetadata.height && expectedHeight > backMetadata.height) {
      alHeight = Math.min(expectedHeight, backMetadata.height) - 1;
      needResize = true;
    }
    if (needResize) {
      overlapImg.resize(alWidth, alHeight);
    }

    const bt = await overlapImg.png().toBuffer();
    const overlay: sharp.OverlayOptions = { input: bt, tile: opt.fill, gravity: opt.g };
    if (opt.t < 100 && imgMetadata.hasAlpha) {
      const overForPng = sharp(await ctx.image.toBuffer()).png();
      const overBuffer = await overForPng.composite([overlay]).removeAlpha().ensureAlpha(opt.t / 100).toBuffer();
      const overlay2: sharp.OverlayOptions = { input: overBuffer };
      ctx.image.composite([overlay2]);
    } else {
      ctx.image.composite([overlay]);
    }
  }

  gravityConvert(param: string): string {
    if (['north', 'west', 'east', 'south', 'center', 'centre', 'southeast', 'southwest', 'northwest'].includes(param)) {
      return param;
    } else if (param === 'se') {
      return 'southeast';
    } else if (param === 'sw') {
      return 'southwest';
    } else if (param === 'nw') {
      return 'northwest';
    } else if (param === 'ne') {
      return 'northeast';
    } else {
      throw new InvalidArgument('Watermark param \'g\' must be in \'north\', \'west\', \'east\', \'south\', \'center\', \'centre\', \'southeast\', \'southwest\', \'northwest\'');
    }
  }

  calculateTextSize(text: string, fontSize: number): WatermarkTextOpts {
    let cWidth = 0;
    for (let v of text) {
      const charCode = v.charCodeAt(0);
      if (charCode > 256) {
        cWidth += fontSize;
      } else if (charCode > 97) {
        cWidth += fontSize / 2;
      } else {
        cWidth += fontSize * 0.8;
      }
    }
    return {
      width: Math.round(cWidth + margin),
      height: Math.round(fontSize * 1.2),
    };
  }
  textSvgStr(opt: WatermarkOpts, textOpt: WatermarkTextOpts, applyOpacity: boolean = true): string {
    const xOffset = Math.round(textOpt.width / 2);
    const yOffset = Math.round(textOpt.height * 0.8);
    const color = `#${opt.color}`;
    const opacity = applyOpacity ? opt.t / 100 : 1;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${textOpt.width} ${textOpt.height}" text-anchor="middle">
    <text font-size='${opt.size}'  x="${xOffset}" y="${yOffset}" fill="${color}" opacity="${opacity}">${opt.text}</text>
    </svg>`;
    return svg;
  }

  textSvgImg(svgBytes: Buffer, textOpt: WatermarkTextOpts): sharp.Sharp {
    const overlapImg = sharp({
      create: {
        width: textOpt.width + margin,
        height: textOpt.height + margin,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    }).composite([{ input: svgBytes }]);

    return overlapImg;
  }

  calculateImgPos(opt: WatermarkOpts, metadata: sharp.Metadata, markMetadata:sharp.Metadata): WatermarkImgOpts {
    let imgX = undefined;
    let imgY = undefined;
    if (markMetadata.width && metadata.width && markMetadata.height && metadata.height) {
      if (['east', 'west', 'center'].includes(opt.g)) {
        imgY = Math.round((metadata.height - markMetadata.height) / 2) + opt.voffset;
      } else {
        if (opt.y) {
          if (opt.g.startsWith('south')) {
            imgY = metadata.height - markMetadata.height - opt.y;
          } else {
            imgY = opt.y;
          }
        }
      }
      if (['north', 'south'].includes(opt.g)) {
        imgX = Math.round((metadata.width - markMetadata.width) / 2);
        if (!imgY) {
          if (opt.g === 'north') {
            imgY = 0;
          } else {
            imgY = metadata.height - markMetadata.height;
          }
        }
      } else {
        if (opt.x) {
          if (opt.g.endsWith('east')) {
            imgX = metadata.width - markMetadata.width - opt.x;
          } else if (opt.g === 'center') {
            imgX = Math.round((metadata.width - markMetadata.width) / 2);
          } else {
            imgX = opt.x;
          }
        }
      }
    }
    return {
      x: imgX,
      y: imgY,
    };

  }

  calculateMixedGravity(opt: WatermarkOpts):WatermarkMixedGravityOpts {
    let imgGravity = 'west';
    let txtGravity = 'east';
    if (opt.order === 1) {
      if (opt.align === 1) {
        imgGravity = 'east';
        txtGravity = 'west';
      } else if (opt.align === 2) {
        imgGravity = 'southeast';
        txtGravity = 'southwest';
      } else {
        imgGravity = 'northeast';
        txtGravity = 'northwest';
      }
    } else {
      if (opt.align === 1) {
        imgGravity = 'west';
        txtGravity = 'east';
      } else if (opt.align === 2) {
        imgGravity = 'southwest';
        txtGravity = 'southeast';
      } else {
        imgGravity = 'northwest';
        txtGravity = 'northeast';
      }
    }
    return {
      imgGravity: imgGravity,
      textGravity: txtGravity,
    };
  }

  async autoResizeImg(source: sharp.Sharp, ctx: IImageContext, opt: WatermarkOpts, textOpt: WatermarkTextOpts): Promise<sharp.Sharp> {
    if (opt.auto) {

      let w = textOpt.width;
      let h = textOpt.height;
      let needResize = false;
      const overlapImgMeta = await source.metadata();
      const metadata = await ctx.image.metadata();

      if (overlapImgMeta.width && metadata.width && overlapImgMeta.width > metadata.width) {
        w = metadata.width - 10;
        needResize = true;
      }
      if (overlapImgMeta.height && metadata.height && overlapImgMeta.height > metadata.height) {
        h = metadata.height - 10;
        needResize = true;
      }

      if (needResize) {
        const overlapImgBuffer = await source.toBuffer();
        source = sharp(overlapImgBuffer);
        source = source.resize(w, h);
      }
    }
    return source;

  }

  async autoResizeSvg(source: Buffer, ctx: IImageContext, opt: WatermarkOpts, textOpt: WatermarkTextOpts): Promise<Buffer> {
    let bt = source;

    if (opt.auto) {
      const metadata = await ctx.image.metadata();
      let w = textOpt.width;
      let h = textOpt.height;
      let needResize = false;
      if (metadata.width && metadata.width < textOpt.width) {
        w = metadata.width;
        needResize = true;
      }
      if (metadata.height && metadata.height < textOpt.height) {
        h = metadata.height;
        needResize = true;
      }
      if (needResize) {
        // hard to resize the svg directly, so attach it on image, then resize the image
        let overlapImg = this.textSvgImg(bt, textOpt);
        const overlapImgBuffer = await overlapImg.png().toBuffer();
        overlapImg = sharp(overlapImgBuffer).png();
        overlapImg = overlapImg.resize(w, h);
        bt = await overlapImg.toBuffer();
      }
    }
    return bt;
  }
}