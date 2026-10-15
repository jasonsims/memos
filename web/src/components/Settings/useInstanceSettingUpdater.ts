import { useCallback } from "react";
import { toast } from "react-hot-toast";
import { useInstance } from "@/contexts/InstanceContext";
import { handleError } from "@/lib/error";
import { getChangedFields, getInstanceSettingTrackProperties, trackPendoEvent } from "@/lib/pendo";
import { InstanceSetting, InstanceSetting_Key } from "@/types/proto/api/instance_service_pb";
import { useTranslate } from "@/utils/i18n";

interface SaveInstanceSettingOptions {
  key: InstanceSetting_Key;
  setting: InstanceSetting;
  errorContext: string;
  showSuccessToast?: boolean;
}

export const buildInstanceSettingName = (key: InstanceSetting_Key) => `instance/settings/${InstanceSetting_Key[key]}`;

const useInstanceSettingUpdater = () => {
  const t = useTranslate();
  const { updateSetting, fetchSetting, settings } = useInstance();

  return useCallback(
    async ({ key, setting, errorContext, showSuccessToast = true }: SaveInstanceSettingOptions) => {
      try {
        await updateSetting(setting);
        // ACCESS is updated in the React Query cache from the mutation response.
        // Refetching it here would duplicate the request after every save.
        if (key !== InstanceSetting_Key.ACCESS) {
          await fetchSetting(key);
        }
        // Field names and a summary of key values only: never secrets, credentials or custom scripts.
        trackPendoEvent("instance_setting_updated", () => ({
          setting_key: InstanceSetting_Key[key],
          changed_fields: getChangedFields(settings.find((item) => item.name === setting.name)?.value.value, setting.value.value ?? {}),
          ...getInstanceSettingTrackProperties(setting),
        }));
        if (showSuccessToast) {
          toast.success(t("message.update-succeed"));
        }
        return true;
      } catch (error: unknown) {
        await handleError(error, toast.error, { context: errorContext });
        return false;
      }
    },
    [fetchSetting, settings, t, updateSetting],
  );
};

export default useInstanceSettingUpdater;
