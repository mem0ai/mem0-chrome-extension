// Extensions for Chrome Extension API
declare namespace chrome {
  namespace runtime {
    interface LastError {
      message?: string;
    }
    
    const lastError: LastError | undefined;
  }
}
