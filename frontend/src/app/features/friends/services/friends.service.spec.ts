import { TestBed } from '@angular/core/testing';
import {
  HttpClientTestingModule,
  HttpTestingController,
} from '@angular/common/http/testing';
import { FriendsService } from './friends.service';

describe('FriendsService', () => {
  let service: FriendsService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [FriendsService],
    });
    service = TestBed.inject(FriendsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should fetch friends balances via GET /api/friends', () => {
    const dummyFriends = [
      { id: '1', name: 'Alice' },
      { id: '2', name: 'Bob' },
    ];

    service.getFriends().subscribe((friends) => {
      expect(friends).toEqual(dummyFriends);
    });

    const req = httpMock.expectOne('/api/v1/friends');
    expect(req.request.method).toBe('GET');
    req.flush(dummyFriends);
  });

  it('should search users via GET /api/users/search', () => {
    const dummyUsers = [{ id: '3', email: 'charlie@example.com' }];
    const query = 'charlie';

    service.searchUsers(query).subscribe((users) => {
      expect(users).toEqual(dummyUsers);
    });

    const req = httpMock.expectOne(
      `/api/v1/users/search?query=${encodeURIComponent(query)}`,
    );
    expect(req.request.method).toBe('GET');
    req.flush(dummyUsers);
  });
});
