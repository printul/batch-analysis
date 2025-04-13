import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { User } from "@/pages/dashboard";

interface UsersListProps {
  onAddUser: () => void;
  onDeleteUser: (userId: number) => void;
  currentUserId: number;
}

export default function UsersList({ onAddUser, onDeleteUser, currentUserId }: UsersListProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const { data: users, isLoading } = useQuery<User[]>({
    queryKey: ['/api/users'],
  });
  
  const formatDate = (dateString: string) => {
    return format(new Date(dateString), 'MMM d, yyyy');
  };
  
  return (
    <div className="px-4 py-6 sm:px-0">
      <div className="border-b border-gray-200 pb-5 mb-5 flex items-center justify-between">
        <div>
          <h3 className="text-lg leading-6 font-medium text-gray-900">User Management</h3>
          <p className="mt-2 max-w-4xl text-sm text-gray-600">
            Add, view, and manage users who can access the dashboard.
          </p>
        </div>
        <Button
          onClick={onAddUser}
          className="inline-flex items-center px-4 py-2"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-1">
            <path d="M5 12h14" />
            <path d="M12 5v14" />
          </svg>
          Add User
        </Button>
      </div>
      
      {isLoading ? (
        <div className="w-full">
          <div className="flex items-center space-x-4 pb-4">
            <Skeleton className="h-4 w-[250px]" />
            <Skeleton className="h-4 w-[200px]" />
            <Skeleton className="h-4 w-[200px]" />
            <Skeleton className="h-4 w-[100px]" />
          </div>
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center space-x-4 py-4 border-t border-gray-200">
              <Skeleton className="h-4 w-[250px]" />
              <Skeleton className="h-4 w-[200px]" />
              <Skeleton className="h-4 w-[200px]" />
              <Skeleton className="h-4 w-[100px]" />
            </div>
          ))}
        </div>
      ) : !users || users.length === 0 ? (
        <div className="bg-white shadow rounded-lg p-8 text-center mt-5">
          <div className="inline-flex items-center justify-center bg-gray-100 rounded-full p-3 mb-4">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-600 text-2xl">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-gray-900">No users found</h3>
          <p className="text-gray-600 mt-1">Add users to grant access to the dashboard.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs font-medium text-gray-600 uppercase tracking-wider">Username</TableHead>
                <TableHead className="text-xs font-medium text-gray-600 uppercase tracking-wider">Role</TableHead>
                <TableHead className="text-xs font-medium text-gray-600 uppercase tracking-wider">Created At</TableHead>
                <TableHead className="text-xs font-medium text-gray-600 uppercase tracking-wider">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell className="whitespace-nowrap text-sm text-gray-900">
                    {user.username}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-gray-600">
                    <Badge className={user.isAdmin ? "bg-sky-100 text-sky-800" : "bg-gray-100 text-gray-800"}>
                      {user.isAdmin ? "Admin" : "User"}
                    </Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-gray-600">
                    {formatDate(user.createdAt)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-gray-600">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onDeleteUser(user.id)}
                      disabled={user.id === currentUserId} // Can't delete yourself
                      className="text-red-500 hover:text-red-700 hover:bg-transparent disabled:opacity-50"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 6h18" />
                        <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                        <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                      </svg>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
