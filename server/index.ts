import { app } from './app.ts'
import { config } from './config.ts'

const PORT = config.port

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Server is running on port ${PORT}`)
})
