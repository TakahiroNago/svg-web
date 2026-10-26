export interface ConvertResult {
  success: boolean
  svg: string
  contourCount: number
  error: string
}

export interface SvgConverterModule {
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
