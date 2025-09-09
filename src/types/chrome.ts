// Extensions for Chrome Extension API
// eslint-disable-next-line @typescript-eslint/no-unused-vars, no-unused-vars
declare namespace chrome {
  namespace runtime {
    interface LastError {
      message?: string;
    }

    const lastError: LastError | undefined;
  }
}
