import { useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { useResolvedUsersByNames } from "@/components/MemoContent/MentionResolutionContext";
import { memoServiceClient } from "@/connect";
import useCurrentUser from "@/hooks/useCurrentUser";
import { memoKeys } from "@/hooks/useMemoQueries";
import { trackPendoEvent } from "@/lib/pendo";
import type { Memo, Reaction } from "@/types/proto/api/memo_service_pb";
import type { User } from "@/types/proto/api/user_service_pb";

export type ReactionGroup = Map<string, User[]>;

export const useReactionGroups = (reactions: Reaction[]): ReactionGroup => {
  const creatorNames = useMemo(() => reactions.map((r) => r.creator), [reactions]);
  const userMap = useResolvedUsersByNames(creatorNames);

  return useMemo(() => {
    const reactionGroup = new Map<string, User[]>();
    for (const reaction of reactions) {
      const user = userMap?.get(reaction.creator);
      if (!user) continue;

      const users = reactionGroup.get(reaction.reactionType) || [];
      users.push(user);
      reactionGroup.set(reaction.reactionType, users);
    }
    return reactionGroup;
  }, [reactions, userMap]);
};

interface UseReactionActionsOptions {
  memo: Memo;
  onComplete?: () => void;
  /** The control reacting: the emoji picker or an existing reaction pill. Reported with the track event. */
  entryPoint?: "picker" | "pill";
}

export const useReactionActions = ({ memo, onComplete, entryPoint }: UseReactionActionsOptions) => {
  const currentUser = useCurrentUser();
  const queryClient = useQueryClient();

  const hasReacted = (reactionType: string) => {
    return memo.reactions.some((r) => r.reactionType === reactionType && r.creator === currentUser?.name);
  };

  const handleReactionClick = async (reactionType: string) => {
    if (!currentUser) return;

    try {
      const removing = hasReacted(reactionType);
      if (removing) {
        const reactions = memo.reactions.filter(
          (reaction) => reaction.reactionType === reactionType && reaction.creator === currentUser.name,
        );
        await Promise.all(reactions.map((reaction) => memoServiceClient.deleteMemoReaction({ name: reaction.name })));
      } else {
        await memoServiceClient.upsertMemoReaction({
          parent: memo.name,
          reaction: { reactionType },
        });
      }
      trackPendoEvent("memo_reaction_toggled", () => ({
        reaction_type: reactionType,
        action: removing ? "removed" : "added",
        is_comment: Boolean(memo.parent),
        is_own_memo: memo.creator === currentUser.name,
        reaction_count: memo.reactions.length,
        entry_point: entryPoint,
      }));
      // Refetch the memo to get updated reactions and invalidate cache
      const updatedMemo = await memoServiceClient.getMemo({ name: memo.name });
      queryClient.setQueryData(memoKeys.detail(memo.name), updatedMemo);
      queryClient.invalidateQueries({ queryKey: memoKeys.lists() });
      // If this memo is a comment, refresh the parent's comments list so the comment's reactions update in the UI
      if (memo.parent) {
        queryClient.invalidateQueries({ queryKey: memoKeys.comments(memo.parent) });
      }
    } catch {
      // skip error
    }
    onComplete?.();
  };

  return { hasReacted, handleReactionClick };
};

export const formatReactionTooltip = (users: User[], reactionType: string): string => {
  if (users.length === 0) return "";
  const formatUserName = (user: User) => user.displayName || user.username;
  if (users.length < 5) {
    return `${users.map(formatUserName).join(", ")} reacted with ${reactionType.toLowerCase()}`;
  }
  return `${users.slice(0, 4).map(formatUserName).join(", ")} and ${users.length - 4} more reacted with ${reactionType.toLowerCase()}`;
};
