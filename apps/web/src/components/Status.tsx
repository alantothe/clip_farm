export function Status({ value }: { value: string }) {
  return (
    <span className={`status status--${value}`}>
      <i />
      {value.replace('_', ' ')}
    </span>
  )
}
