import { z } from 'zod'

const CoordinateSchema = z.string().max(48).refine((value) => {
  if (!/^-?\d{1,3}(\.\d+)?,-?\d{1,2}(\.\d+)?$/.test(value)) return false
  const [lng, lat] = value.split(',').map(Number)
  return lng !== undefined && lat !== undefined && Math.abs(lng) <= 180 && Math.abs(lat) <= 90
}, '坐标须为合法的 BD09 经度,纬度')

const list = (schema: z.ZodType, max: number) => z.preprocess(
  (value) => value === undefined ? undefined : Array.isArray(value) ? value : [value],
  z.array(schema).max(max).optional(),
)
const PathSchema = z.string().max(1600).refine((value) => {
  const points = value.split(';')
  return points.length >= 2 && points.length <= 50 && points.every((p) => CoordinateSchema.safeParse(p).success)
}, '路线须由 2–50 个合法坐标构成')

export const StaticMapQuerySchema = z.object({
  center: CoordinateSchema.optional(),
  zoom: z.coerce.number().int().min(3).max(19).optional(),
  width: z.coerce.number().int().min(50).max(1024).default(640),
  height: z.coerce.number().int().min(50).max(1024).default(360),
  scale: z.coerce.number().int().min(1).max(2).optional(),
  markers: list(CoordinateSchema, 50) as z.ZodType<string[] | undefined>,
  paths: list(PathSchema, 10) as z.ZodType<string[] | undefined>,
  markerStyles: z.string().max(1200).regex(/^[sml],[0-9A-Z],0x[0-9A-Fa-f]{6}(\|[sml],[0-9A-Z],0x[0-9A-Fa-f]{6})*$/).optional(),
  pathStyles: z.string().max(80).regex(/^0x[0-9a-fA-F]{6},(?:[3-9]|[12]\d|3[0-2]),(?:0(?:\.\d+)?|1(?:\.0+)?)$/).optional(),
})

export const PanoramaQuerySchema = z.object({
  location: CoordinateSchema,
  width: z.coerce.number().int().min(10).max(1024).default(640),
  height: z.coerce.number().int().min(10).max(512).default(360),
  heading: z.coerce.number().min(0).max(360).optional(),
  pitch: z.coerce.number().min(-90).max(90).optional(),
  fov: z.coerce.number().min(10).max(360).optional(),
})
