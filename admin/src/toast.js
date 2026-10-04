import { toast } from "react-toastify";

export const notify = {
  ok: (message) => toast.success(message),
  err: (message) => toast.error(message || "Something went wrong"),
  info: (message) => toast.info(message),
};
