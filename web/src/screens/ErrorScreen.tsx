import type { ErrorKind } from '../types'
import Brand from './Brand'

const TEXT: Record<ErrorKind, [string, string]> = {
  network: ['Немає зʼєднання з інтернетом', 'Перевірте мобільний інтернет або Wi-Fi. Фото знімати знову не потрібно.'],
  server: ['Сервер не відповів', 'Не вдалося перевірити фото. Спробуйте ще раз за хвилину.'],
  photo: ['Фото не прочиталось', 'Файл пошкоджений або має непідтримуваний формат. Оберіть інше фото, наприклад JPEG.'],
}

export default function ErrorScreen({ kind, onRetry, onHome }: { kind: ErrorKind; onRetry: () => void; onHome: () => void }) {
  const [title, text] = TEXT[kind]
  return (
    <main className="page home">
      <Brand />
      <section className="home-hero">
        <h1 className="title-l">{title}</h1>
        <p className="lead">{text}</p>
      </section>
      <div className="actions">
        <button className="btn btn-primary" onClick={onRetry}>Спробувати ще раз</button>
        {kind !== 'photo' && <button className="btn btn-secondary" onClick={onHome}>На головну</button>}
      </div>
    </main>
  )
}
