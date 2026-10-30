// Draws a small flat-color landscape icon, which converts cleanly and shows off the comparison.
// Generated in the browser so the app ships no binary sample file.
export async function createSampleImage(): Promise<File> {
  const size = 480
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const c = canvas.getContext('2d')
  if (!c) throw new Error('Canvas を利用できません。')

  c.fillStyle = '#ffffff'
  c.fillRect(0, 0, size, size)

  c.save()
  c.beginPath()
  c.roundRect(48, 48, 384, 384, 80)
  c.clip()

  c.fillStyle = '#4c6ef5'
  c.fillRect(48, 48, 384, 384)

  c.fillStyle = '#ffd43b'
  c.beginPath()
  c.arc(330, 160, 52, 0, Math.PI * 2)
  c.fill()

  c.fillStyle = '#74b816'
  c.beginPath()
  c.moveTo(48, 400)
  c.lineTo(200, 220)
  c.lineTo(300, 330)
  c.lineTo(360, 270)
  c.lineTo(432, 350)
  c.lineTo(432, 432)
  c.lineTo(48, 432)
  c.closePath()
  c.fill()

  c.fillStyle = '#2b8a3e'
  c.beginPath()
  c.moveTo(48, 432)
  c.quadraticCurveTo(240, 330, 432, 400)
  c.lineTo(432, 432)
  c.closePath()
  c.fill()
  c.restore()

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('サンプル画像を作成できませんでした。')
  return new File([blob], 'sample.png', { type: 'image/png' })
}
