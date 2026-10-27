export interface ConvertResult {
  success: boolean
  svg: string
  contourCount: number
  error: string
}

export interface PaletteColor {
  index: number
  hex: string
  area: number
}

export interface AnalyzeResult {
  success: boolean
  palette: PaletteColor[]
  error: string
}

export interface SvgSession {
  analyze(
    rgba: Uint8Array | Uint8ClampedArray,
    width: number,
    height: number,
    colorCount: number,
  ): AnalyzeResult
  generate(keptColors: number[], boundary: boolean): ConvertResult
  delete(): void
}

export interface SvgConverterModule {
  SvgSession: new () => SvgSession
  convertImage(
    rgba: Uint8Array | Uint8ClampedArray,
    width: number,
    height: number,
    colorCount: number,
    keptColors: number[],
    boundary: boolean,
  ): ConvertResult
}

export interface ModuleOptions {
  locateFile?: (path: string, prefix: string) => string
}

export default function createSvgConverterModule(
  options?: ModuleOptions,
): Promise<SvgConverterModule>
