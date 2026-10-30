import { useEffect, useRef } from 'react'
import type { ConverterMode } from './converter/mode.ts'
import { MAX_FILE_BYTES, MAX_PIXELS, MAX_SIDE } from './converter/limits.ts'

export type HelpTopic = 'howto' | 'faq'

function HowTo() {
  return (
    <ol className="help-steps">
      <li>
        <b>画像を読み込む</b>
        ドロップ、「ファイルを選択」、Ctrl+V での貼り付け、または「サンプルで試す」で読み込みます。読み込むとすぐに変換が始まります。
      </li>
      <li>
        <b>用途と色数を選ぶ</b>
        「ロゴ」「イラスト」「写真」から近いものを選び、色数スライダーで調整します。設定は変更から少し待つと自動で反映されます。
      </li>
      <li>
        <b>比較して確かめる</b>
        中央のつまみを左右にドラッグすると、元画像と SVG を見比べられます。Ctrl + ホイール（スマホはピンチ）で拡大し、ダブルクリックで元に戻します。
      </li>
      <li>
        <b>不要な色を外す</b>
        「詳細設定」を開くと、使う色を選べます。外した色の部分は SVG に描かれません。
      </li>
      <li>
        <b>保存する</b>
        「SVGをダウンロード」で保存するか、「コードをコピー」で SVG のコードをそのまま貼り付けられます。
      </li>
    </ol>
  )
}

function Faq({ mode }: { mode: ConverterMode }) {
  return (
    <dl className="help-faq">
      <dt>画像はどこで処理されますか？</dt>
      <dd>
        {mode === 'server'
          ? '変換のためにサーバーへ送信され、サーバー上で SVG に変換されます。機密性の高い画像や個人情報を含む画像はアップロードしないでください。'
          : 'ブラウザの中だけで変換します。画像が外部に送信されることはありません。'}
      </dd>
      <dt>どんな画像を変換できますか？</dt>
      <dd>
        PNG と JPEG です。ファイルサイズは {MAX_FILE_BYTES / 1024 / 1024} MB まで、画像の大きさは 1 辺 {MAX_SIDE}px 以下・合計{' '}
        {MAX_PIXELS.toLocaleString()} 画素以下に対応しています。
      </dd>
      <dt>どんな画像に向いていますか？</dt>
      <dd>
        ロゴやイラストのように、色の数が少なく輪郭がはっきりした画像に向いています。写真も変換できますが、形が複雑になるためファイルが大きくなりがちです。
      </dd>
      <dt>色数はどう決めればよいですか？</dt>
      <dd>
        少ないほどシンプルで軽い SVG に、多いほど元画像に近い SVG になります。まず用途を選び、比較表示を見ながら調整してください。
      </dd>
      <dt>「線だけで描く」とは何ですか？</dt>
      <dd>色の塗りをせず、色の境目を線だけで描いた SVG を作ります。カッティングや下絵に使えます。</dd>
    </dl>
  )
}

export function HelpDialog({
  topic,
  mode,
  onClose,
}: {
  topic: HelpTopic | null
  mode: ConverterMode
  onClose: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (topic && !d.open) {
      if (typeof d.showModal === 'function') d.showModal()
      else d.setAttribute('open', '')
    } else if (!topic && d.open) {
      if (typeof d.close === 'function') d.close()
      else d.removeAttribute('open')
    }
  }, [topic])

  const title = topic === 'faq' ? 'よくある質問' : '使い方'
  return (
    <dialog
      ref={ref}
      className="help-dialog"
      aria-label={title}
      onClose={onClose}
      onClick={(e) => {
        // A click on the backdrop lands on the dialog element itself.
        if (e.target === e.currentTarget) onClose()
      }}
    >
      {topic && (
        <div className="help-body">
          <div className="help-head">
            <h2>{title}</h2>
            <button type="button" className="icon-button" aria-label="閉じる" onClick={onClose}>
              ×
            </button>
          </div>
          {topic === 'faq' ? <Faq mode={mode} /> : <HowTo />}
        </div>
      )}
    </dialog>
  )
}
