import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => ({
  approveMutate: vi.fn(),
  saveReviewProgressMutate: vi.fn(),
  setLocation: vi.fn(),
  reviewProgressData: { reviewedAssetIds: [] as number[] },
  assets: [] as Array<{ id: number; status: string; templateSize: string }>,
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetBrief: () => ({
    data: { id: 1, campaignName: "Spring Sale", brand: { id: 1, name: "Acme" } },
    isLoading: false,
  }),
  useListAssets: () => ({ data: mocks.assets, isLoading: false }),
  useUpdateAsset: () => ({ mutate: vi.fn(), isPending: false }),
  useRegenerateAsset: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteAsset: () => ({ mutate: vi.fn(), isPending: false }),
  useApproveBrief: () => ({ mutate: mocks.approveMutate, isPending: false }),
  useGetReviewProgress: () => ({
    data: mocks.reviewProgressData,
    isLoading: false,
    isSuccess: true,
  }),
  useSaveReviewProgress: () => ({ mutate: mocks.saveReviewProgressMutate }),
  useCreateBriefAdTags: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  getGetBriefQueryKey: () => ["brief", 1],
  getListAssetsQueryKey: () => ["assets", 1],
  getListBriefsQueryKey: () => ["briefs"],
  getGetReviewProgressQueryKey: () => ["review-progress", 1],
}));

vi.mock("wouter", () => ({
  useParams: () => ({ id: "1" }),
  useLocation: () => ["/briefs/1/approve", mocks.setLocation],
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn(), setQueryData: vi.fn() }),
}));

vi.mock("@/hooks/use-me", () => ({
  useMe: () => ({ data: { id: 42, clerkId: "c", role: "admin", email: null, name: null } }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/components/TemplateRenderer", () => ({
  TemplateThumbnail: () => <div data-testid="template-thumbnail" />,
  getTemplateLabel: (key: string) => key,
}));

vi.mock("@/components/HtmlBannerEditor", () => ({ default: () => <div /> }));
vi.mock("@/components/AssetLightbox", () => ({ default: () => <div /> }));
vi.mock("@/components/AssetCompare", () => ({ default: () => <div /> }));

import ApproveScreen from "./Approve";

function makeAssets(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    status: "pending",
    templateSize: "square",
  }));
}

describe("ApproveScreen — approve without reviewing warning", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.assets = makeAssets(2);
    mocks.reviewProgressData = { reviewedAssetIds: [] };
  });

  it("opens the confirmation dialog and does not approve when some assets are unreviewed", async () => {
    const user = userEvent.setup();
    render(<ApproveScreen />);

    await user.click(screen.getByTestId("button-approve-all"));

    expect(await screen.findByTestId("dialog-confirm-approve")).toBeInTheDocument();
    expect(mocks.approveMutate).not.toHaveBeenCalled();
  });

  it("approves when 'Approve anyway' is clicked from the dialog", async () => {
    const user = userEvent.setup();
    render(<ApproveScreen />);

    await user.click(screen.getByTestId("button-approve-all"));
    const dialog = await screen.findByTestId("dialog-confirm-approve");
    await user.click(within(dialog).getByTestId("button-confirm-approve"));

    expect(mocks.approveMutate).toHaveBeenCalledTimes(1);
  });

  it("dismisses without approving when 'Go back to review' is clicked", async () => {
    const user = userEvent.setup();
    render(<ApproveScreen />);

    await user.click(screen.getByTestId("button-approve-all"));
    const dialog = await screen.findByTestId("dialog-confirm-approve");
    await user.click(within(dialog).getByTestId("button-cancel-approve"));

    await waitFor(() => {
      expect(screen.queryByTestId("dialog-confirm-approve")).not.toBeInTheDocument();
    });
    expect(mocks.approveMutate).not.toHaveBeenCalled();
  });

  it("approves immediately with no dialog when all assets have been previewed", async () => {
    mocks.reviewProgressData = { reviewedAssetIds: [1, 2] };
    const user = userEvent.setup();
    render(<ApproveScreen />);

    await waitFor(() => {
      expect(screen.getByTestId("review-progress-count")).toHaveTextContent("2/2 reviewed");
    });

    await user.click(screen.getByTestId("button-approve-all"));

    expect(screen.queryByTestId("dialog-confirm-approve")).not.toBeInTheDocument();
    expect(mocks.approveMutate).toHaveBeenCalledTimes(1);
  });
});
