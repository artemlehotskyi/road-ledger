import { ArrowBack } from '../icons'

export default function Header({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <header className="header">
      <button className="icon-btn" onClick={onBack} aria-label="Назад">
        <ArrowBack />
      </button>
      <h1>{title}</h1>
    </header>
  )
}
