import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { format } from "date-fns";

interface TwitterAccountsListProps {
  isAdmin: boolean;
}

interface TwitterAccount {
  id: number;
  username: string;
  name: string | null;
  lastFetched: string | null;
  createdAt: string;
}

const formSchema = z.object({
  username: z.string().min(1, "Username is required").max(15, "Twitter usernames cannot exceed 15 characters"),
  name: z.string().optional(),
});

type FormData = z.infer<typeof formSchema>;

export default function TwitterAccountsList({ isAdmin }: TwitterAccountsListProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [accountToDelete, setAccountToDelete] = useState<number | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      username: "",
      name: "",
    },
  });

  // Get all Twitter accounts
  const { data: accounts = [], isLoading } = useQuery<TwitterAccount[]>({
    queryKey: ['/api/twitter-accounts'],
    enabled: true,
  });

  // Add Twitter account mutation
  const addAccountMutation = useMutation({
    mutationFn: async (data: FormData) => {
      return apiRequest('POST', '/api/twitter-accounts', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/twitter-accounts'] });
      setIsAddDialogOpen(false);
      form.reset();
      toast({
        title: "Account added",
        description: "The Twitter account has been added successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to add Twitter account.",
        variant: "destructive",
      });
    },
  });

  // Delete Twitter account mutation
  const deleteAccountMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest('DELETE', `/api/twitter-accounts/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/twitter-accounts'] });
      setIsDeleteDialogOpen(false);
      setAccountToDelete(null);
      toast({
        title: "Account deleted",
        description: "The Twitter account has been removed successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete Twitter account.",
        variant: "destructive",
      });
    },
  });

  // Manual fetch tweets mutation
  const fetchTweetsMutation = useMutation({
    mutationFn: async () => {
      return apiRequest('POST', '/api/fetch-tweets');
    },
    onSuccess: () => {
      toast({
        title: "Fetch initiated",
        description: "Tweet fetching has been initiated. Tweets will appear shortly.",
      });
      // Refetch account list to show updated lastFetched dates
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['/api/twitter-accounts'] });
        queryClient.invalidateQueries({ queryKey: ['/api/tweets'] });
      }, 5000);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to initiate tweet fetch.",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: FormData) => {
    addAccountMutation.mutate(data);
  };

  const handleDeleteClick = (id: number) => {
    setAccountToDelete(id);
    setIsDeleteDialogOpen(true);
  };

  const confirmDelete = () => {
    if (accountToDelete) {
      deleteAccountMutation.mutate(accountToDelete);
    }
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "Never";
    try {
      return format(new Date(dateString), "MMM d, yyyy h:mm a");
    } catch (e) {
      return "Invalid date";
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Twitter Accounts</h2>
        <div className="flex gap-2">
          {isAdmin && (
            <Button 
              onClick={() => setIsAddDialogOpen(true)}
              className="flex items-center gap-2"
            >
              <Plus className="h-4 w-4" />
              Add Account
            </Button>
          )}
          {isAdmin && (
            <Button 
              onClick={() => fetchTweetsMutation.mutate()}
              variant="outline"
              className="flex items-center gap-2"
              disabled={fetchTweetsMutation.isPending}
            >
              {fetchTweetsMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Fetch Tweets Now
            </Button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : accounts?.length === 0 ? (
        <div className="text-center py-8 border rounded-lg bg-muted/20">
          <p>No Twitter accounts added yet.</p>
          {isAdmin && (
            <Button 
              onClick={() => setIsAddDialogOpen(true)} 
              variant="link"
              className="mt-2"
            >
              Add your first account
            </Button>
          )}
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Username</TableHead>
                <TableHead>Display Name</TableHead>
                <TableHead>Last Fetched</TableHead>
                <TableHead>Added On</TableHead>
                {isAdmin && <TableHead className="w-[100px]">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts?.map((account: TwitterAccount) => (
                <TableRow key={account.id}>
                  <TableCell className="font-medium">@{account.username}</TableCell>
                  <TableCell>{account.name || account.username}</TableCell>
                  <TableCell>{formatDate(account.lastFetched)}</TableCell>
                  <TableCell>{formatDate(account.createdAt)}</TableCell>
                  {isAdmin && (
                    <TableCell>
                      <Button
                        onClick={() => handleDeleteClick(account.id)}
                        variant="ghost"
                        size="icon"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Add Account Dialog */}
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Twitter Account</DialogTitle>
            <DialogDescription>
              Enter a Twitter username to follow and display tweets from that account.
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="username"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Twitter Username</FormLabel>
                    <FormControl>
                      <Input 
                        placeholder="e.g. Twitter" 
                        {...field} 
                        autoComplete="off"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Display Name (Optional)</FormLabel>
                    <FormControl>
                      <Input 
                        placeholder="e.g. Twitter Official" 
                        {...field} 
                        autoComplete="off"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button 
                  type="button" 
                  variant="outline" 
                  onClick={() => setIsAddDialogOpen(false)}
                >
                  Cancel
                </Button>
                <Button 
                  type="submit"
                  disabled={addAccountMutation.isPending}
                >
                  {addAccountMutation.isPending && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Add Account
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Deletion</DialogTitle>
            <DialogDescription>
              Are you sure you want to remove this Twitter account? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => setIsDeleteDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button 
              variant="destructive"
              onClick={confirmDelete}
              disabled={deleteAccountMutation.isPending}
            >
              {deleteAccountMutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}