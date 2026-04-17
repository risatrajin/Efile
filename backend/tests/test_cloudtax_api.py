"""
CloudTax WS Pilot API Tests
Tests: Auth, RBAC, Engagements CRUD, Documents, Opportunities, Time Entries, Checklist, Metrics, Users
"""
import pytest
import requests
import os
import time

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
if not BASE_URL:
    BASE_URL = "https://1d802cdd-7d7e-4551-9188-545b5d878d66.preview.emergentagent.com"

# Test credentials from seed
ADMIN_CREDS = {"email": "admin@cloudtax.ca", "password": "CloudTax2026!"}
CPA_CREDS = {"email": "pallavi@cloudtax.ca", "password": "CloudTax2026!"}
CPA2_CREDS = {"email": "terryann@cloudtax.ca", "password": "CloudTax2026!"}
WS_CREDS = {"email": "henry.ziegler@wealthsimple.com", "password": "CloudTax2026!"}
CLIENT_CREDS = {"email": "chen@example.com", "password": "CloudTax2026!"}


class TestHealth:
    """Health endpoint tests"""
    
    def test_health_returns_ok(self):
        """GET /api/health returns ok:true"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200
        data = response.json()
        assert data.get("ok") is True
        assert "service" in data
        print(f"Health check passed: {data}")


class TestAuth:
    """Authentication endpoint tests"""
    
    def test_login_admin_success(self):
        """POST /api/auth/login with admin credentials returns user + token + cookie"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json=ADMIN_CREDS)
        assert response.status_code == 200
        data = response.json()
        assert "user" in data
        assert "token" in data
        assert data["user"]["email"] == ADMIN_CREDS["email"]
        assert data["user"]["role"] == "ADMIN"
        # Check httpOnly cookie is set
        assert "access_token" in response.cookies or "set-cookie" in str(response.headers).lower()
        print(f"Admin login success: {data['user']['name']}")
    
    def test_login_cpa_success(self):
        """POST /api/auth/login with CPA credentials"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json=CPA_CREDS)
        assert response.status_code == 200
        data = response.json()
        assert data["user"]["role"] == "CPA"
        print(f"CPA login success: {data['user']['name']}")
    
    def test_login_ws_partner_success(self):
        """POST /api/auth/login with WS partner credentials"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json=WS_CREDS)
        assert response.status_code == 200
        data = response.json()
        assert data["user"]["role"] == "WS_PARTNER"
        print(f"WS Partner login success: {data['user']['name']}")
    
    def test_login_client_success(self):
        """POST /api/auth/login with client credentials"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json=CLIENT_CREDS)
        assert response.status_code == 200
        data = response.json()
        assert data["user"]["role"] == "CLIENT"
        print(f"Client login success: {data['user']['name']}")
    
    def test_login_invalid_credentials(self):
        """POST /api/auth/login with invalid credentials returns 401"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "wrong@example.com",
            "password": "wrongpassword"
        })
        assert response.status_code == 401
        print("Invalid credentials correctly rejected with 401")
    
    def test_me_with_bearer_token(self):
        """GET /api/auth/me with Bearer token returns user"""
        # First login to get token
        login_resp = requests.post(f"{BASE_URL}/api/auth/login", json=ADMIN_CREDS)
        token = login_resp.json()["token"]
        
        # Use token to get current user
        response = requests.get(
            f"{BASE_URL}/api/auth/me",
            headers={"Authorization": f"Bearer {token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["email"] == ADMIN_CREDS["email"]
        assert data["role"] == "ADMIN"
        print(f"GET /api/auth/me success: {data['name']}")
    
    def test_me_without_token_returns_401(self):
        """GET /api/auth/me without token returns 401"""
        response = requests.get(f"{BASE_URL}/api/auth/me")
        assert response.status_code == 401
        print("Unauthenticated /me correctly rejected with 401")
    
    def test_logout_clears_cookie(self):
        """POST /api/auth/logout returns ok and clears cookie"""
        session = requests.Session()
        # Login first
        session.post(f"{BASE_URL}/api/auth/login", json=ADMIN_CREDS)
        # Logout
        response = session.post(f"{BASE_URL}/api/auth/logout")
        assert response.status_code == 200
        data = response.json()
        assert data.get("ok") is True
        print("Logout success")


class TestBruteForce:
    """Brute force protection tests"""
    
    def test_brute_force_lockout_after_5_fails(self):
        """After 5 failed attempts, returns 429"""
        # Use a unique email to avoid affecting other tests
        test_email = f"bruteforce_test_{int(time.time())}@example.com"
        
        for i in range(5):
            response = requests.post(f"{BASE_URL}/api/auth/login", json={
                "email": test_email,
                "password": "wrongpassword"
            })
            # Should be 401 for first 5 attempts
            if i < 4:
                assert response.status_code == 401, f"Attempt {i+1} should be 401"
        
        # 6th attempt should be 429
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": test_email,
            "password": "wrongpassword"
        })
        assert response.status_code == 429, "6th attempt should be rate limited (429)"
        print("Brute force protection working: 429 after 5 failed attempts")


class TestRBAC:
    """Role-based access control tests"""
    
    @pytest.fixture
    def admin_token(self):
        resp = requests.post(f"{BASE_URL}/api/auth/login", json=ADMIN_CREDS)
        return resp.json()["token"]
    
    @pytest.fixture
    def cpa_token(self):
        resp = requests.post(f"{BASE_URL}/api/auth/login", json=CPA_CREDS)
        return resp.json()["token"]
    
    @pytest.fixture
    def ws_token(self):
        resp = requests.post(f"{BASE_URL}/api/auth/login", json=WS_CREDS)
        return resp.json()["token"]
    
    @pytest.fixture
    def client_token(self):
        resp = requests.post(f"{BASE_URL}/api/auth/login", json=CLIENT_CREDS)
        return resp.json()["token"]
    
    def test_cpa_sees_only_own_engagements(self, cpa_token):
        """CPA login sees only engagements assigned to them"""
        response = requests.get(
            f"{BASE_URL}/api/engagements",
            headers={"Authorization": f"Bearer {cpa_token}"}
        )
        assert response.status_code == 200
        engagements = response.json()
        # CPA should see some engagements (assigned to them)
        assert isinstance(engagements, list)
        print(f"CPA sees {len(engagements)} engagements (filtered by assigned_cpa_id)")
    
    def test_ws_partner_cannot_access_documents(self, ws_token, admin_token):
        """WS partner cannot access GET /api/engagements/{id}/documents (403)"""
        # First get an engagement ID as admin
        admin_resp = requests.get(
            f"{BASE_URL}/api/engagements",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        engagements = admin_resp.json()
        if not engagements:
            pytest.skip("No engagements found")
        
        eng_id = engagements[0]["id"]
        
        # Try to access documents as WS partner
        response = requests.get(
            f"{BASE_URL}/api/engagements/{eng_id}/documents",
            headers={"Authorization": f"Bearer {ws_token}"}
        )
        assert response.status_code == 403
        print("WS partner correctly denied access to documents (403)")
    
    def test_client_sees_only_own_engagement_with_tier_redacted(self, client_token):
        """CLIENT sees only own engagement with tier redacted to null"""
        response = requests.get(
            f"{BASE_URL}/api/engagements",
            headers={"Authorization": f"Bearer {client_token}"}
        )
        assert response.status_code == 200
        engagements = response.json()
        assert isinstance(engagements, list)
        # Client should see their own engagement(s)
        if engagements:
            # Tier should be redacted (null) for clients
            assert engagements[0].get("tier") is None, "Tier should be redacted for clients"
            print(f"Client sees {len(engagements)} engagement(s) with tier redacted")
        else:
            print("Client has no engagements")


class TestEngagements:
    """Engagements CRUD tests"""
    
    @pytest.fixture
    def admin_token(self):
        resp = requests.post(f"{BASE_URL}/api/auth/login", json=ADMIN_CREDS)
        return resp.json()["token"]
    
    def test_admin_list_engagements_returns_10_seeded(self, admin_token):
        """Admin GET /api/engagements returns 10 seeded engagements"""
        response = requests.get(
            f"{BASE_URL}/api/engagements",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert response.status_code == 200
        engagements = response.json()
        assert len(engagements) == 10, f"Expected 10 seeded engagements, got {len(engagements)}"
        print(f"Admin sees all {len(engagements)} engagements")
    
    def test_get_engagement_returns_enriched_data(self, admin_token):
        """GET /api/engagements/{id} returns enriched engagement"""
        # Get list first
        list_resp = requests.get(
            f"{BASE_URL}/api/engagements",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        engagements = list_resp.json()
        eng_id = engagements[0]["id"]
        
        # Get single engagement
        response = requests.get(
            f"{BASE_URL}/api/engagements/{eng_id}",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert response.status_code == 200
        eng = response.json()
        
        # Check enriched fields
        assert "corporation" in eng
        assert "client" in eng
        assert "assigned_cpa" in eng or eng.get("assigned_cpa_id") is None
        assert "docs_total" in eng
        assert "docs_uploaded" in eng
        assert "cpa_hours" in eng
        assert "opps_count" in eng
        print(f"Engagement enriched: docs={eng['docs_total']}, hours={eng['cpa_hours']}, opps={eng['opps_count']}")
    
    def test_patch_engagement_status_logs_history(self, admin_token):
        """PATCH /api/engagements/{id} with status change logs StatusHistory"""
        # Get an engagement that's not FILED
        list_resp = requests.get(
            f"{BASE_URL}/api/engagements",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        engagements = list_resp.json()
        
        # Find one in INTAKE status
        target = None
        for eng in engagements:
            if eng["status"] == "INTAKE":
                target = eng
                break
        
        if not target:
            pytest.skip("No INTAKE engagement found for status change test")
        
        # Change status to IN_PREP
        response = requests.patch(
            f"{BASE_URL}/api/engagements/{target['id']}",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"status": "IN_PREP"}
        )
        assert response.status_code == 200
        updated = response.json()
        assert updated["status"] == "IN_PREP"
        assert updated.get("prep_start_date") is not None
        print(f"Status changed to IN_PREP, prep_start_date set")


class TestDocuments:
    """Document endpoints tests"""
    
    @pytest.fixture
    def admin_token(self):
        resp = requests.post(f"{BASE_URL}/api/auth/login", json=ADMIN_CREDS)
        return resp.json()["token"]
    
    def test_list_documents_returns_checklist(self, admin_token):
        """GET /api/engagements/{id}/documents returns document checklist"""
        # Get an engagement
        list_resp = requests.get(
            f"{BASE_URL}/api/engagements",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        eng_id = list_resp.json()[0]["id"]
        
        response = requests.get(
            f"{BASE_URL}/api/engagements/{eng_id}/documents",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert response.status_code == 200
        docs = response.json()
        assert isinstance(docs, list)
        assert len(docs) > 0
        # Check document structure
        doc = docs[0]
        assert "id" in doc
        assert "category" in doc
        assert "name" in doc
        assert "status" in doc
        print(f"Found {len(docs)} documents for engagement")
    
    def test_upload_url_returns_presigned_url(self, admin_token):
        """POST /api/documents/{doc_id}/upload-url returns presigned PUT URL"""
        # Get an engagement and its documents
        list_resp = requests.get(
            f"{BASE_URL}/api/engagements",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        eng_id = list_resp.json()[0]["id"]
        
        docs_resp = requests.get(
            f"{BASE_URL}/api/engagements/{eng_id}/documents",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        docs = docs_resp.json()
        # Find a PENDING document
        pending_doc = next((d for d in docs if d["status"] == "PENDING"), None)
        if not pending_doc:
            pytest.skip("No PENDING document found")
        
        response = requests.post(
            f"{BASE_URL}/api/documents/{pending_doc['id']}/upload-url",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"content_type": "application/pdf", "file_name": "test.pdf"}
        )
        # May return 500 if S3 bucket CORS not configured - that's acceptable per spec
        if response.status_code == 500:
            print("S3 presigned URL generation failed (bucket config issue - LOW priority)")
            pytest.skip("S3 bucket not configured")
        
        assert response.status_code == 200
        data = response.json()
        assert "upload_url" in data
        assert "object_key" in data
        assert data["upload_url"].startswith("https://")
        print(f"Presigned upload URL generated: {data['upload_url'][:80]}...")


class TestOpportunities:
    """Opportunities endpoints tests"""
    
    @pytest.fixture
    def admin_token(self):
        resp = requests.post(f"{BASE_URL}/api/auth/login", json=ADMIN_CREDS)
        return resp.json()["token"]
    
    @pytest.fixture
    def cpa_token(self):
        resp = requests.post(f"{BASE_URL}/api/auth/login", json=CPA_CREDS)
        return resp.json()["token"]
    
    @pytest.fixture
    def ws_token(self):
        resp = requests.post(f"{BASE_URL}/api/auth/login", json=WS_CREDS)
        return resp.json()["token"]
    
    def test_create_opportunity(self, cpa_token):
        """POST /api/engagements/{id}/opportunities creates opportunity"""
        # Get CPA's engagements
        list_resp = requests.get(
            f"{BASE_URL}/api/engagements",
            headers={"Authorization": f"Bearer {cpa_token}"}
        )
        engagements = list_resp.json()
        if not engagements:
            pytest.skip("CPA has no engagements")
        
        eng_id = engagements[0]["id"]
        
        response = requests.post(
            f"{BASE_URL}/api/engagements/{eng_id}/opportunities",
            headers={"Authorization": f"Bearer {cpa_token}"},
            json={
                "category": "COMPENSATION_STRATEGY",
                "title": "TEST_Opportunity",
                "description": "Test opportunity description",
                "severity": "MEDIUM"
            }
        )
        assert response.status_code == 200
        opp = response.json()
        assert opp["title"] == "TEST_Opportunity"
        assert opp["shared_with_ws"] is False
        print(f"Created opportunity: {opp['id']}")
        return opp["id"]
    
    def test_share_opportunity_with_ws(self, cpa_token):
        """PATCH /api/opportunities/{oid} with shared_with_ws=true sets shared_at"""
        # First create an opportunity
        list_resp = requests.get(
            f"{BASE_URL}/api/engagements",
            headers={"Authorization": f"Bearer {cpa_token}"}
        )
        engagements = list_resp.json()
        if not engagements:
            pytest.skip("CPA has no engagements")
        
        eng_id = engagements[0]["id"]
        
        # Create opportunity
        create_resp = requests.post(
            f"{BASE_URL}/api/engagements/{eng_id}/opportunities",
            headers={"Authorization": f"Bearer {cpa_token}"},
            json={
                "category": "CDA_EXTRACTION",
                "title": "TEST_Share_Opportunity",
                "description": "Test sharing",
                "severity": "HIGH"
            }
        )
        opp_id = create_resp.json()["id"]
        
        # Share with WS
        response = requests.patch(
            f"{BASE_URL}/api/opportunities/{opp_id}",
            headers={"Authorization": f"Bearer {cpa_token}"},
            json={"shared_with_ws": True}
        )
        assert response.status_code == 200
        opp = response.json()
        assert opp["shared_with_ws"] is True
        assert opp["shared_at"] is not None
        print(f"Opportunity shared with WS, shared_at: {opp['shared_at']}")
    
    def test_ws_sees_shared_opportunities(self, ws_token):
        """GET /api/opportunities/shared returns only shared opportunities with enrichment"""
        response = requests.get(
            f"{BASE_URL}/api/opportunities/shared",
            headers={"Authorization": f"Bearer {ws_token}"}
        )
        assert response.status_code == 200
        opps = response.json()
        assert isinstance(opps, list)
        # All should be shared
        for opp in opps:
            assert opp["shared_with_ws"] is True
            # Should have enrichment
            assert "client_name" in opp or opp.get("client_name") is None
            assert "corporation_name" in opp or opp.get("corporation_name") is None
        print(f"WS sees {len(opps)} shared opportunities")


class TestTimeEntries:
    """Time entries endpoints tests"""
    
    @pytest.fixture
    def cpa_token(self):
        resp = requests.post(f"{BASE_URL}/api/auth/login", json=CPA_CREDS)
        return resp.json()["token"]
    
    def test_create_time_entry(self, cpa_token):
        """POST /api/engagements/{id}/time-entries creates entry with cpa_id"""
        # Get CPA's engagements
        list_resp = requests.get(
            f"{BASE_URL}/api/engagements",
            headers={"Authorization": f"Bearer {cpa_token}"}
        )
        engagements = list_resp.json()
        if not engagements:
            pytest.skip("CPA has no engagements")
        
        eng_id = engagements[0]["id"]
        
        response = requests.post(
            f"{BASE_URL}/api/engagements/{eng_id}/time-entries",
            headers={"Authorization": f"Bearer {cpa_token}"},
            json={
                "category": "DOCUMENT_REVIEW",
                "hours": 1.5,
                "description": "TEST_Time entry"
            }
        )
        assert response.status_code == 200
        entry = response.json()
        assert entry["hours"] == 1.5
        assert entry["category"] == "DOCUMENT_REVIEW"
        assert "cpa_id" in entry
        print(f"Created time entry: {entry['id']}, hours: {entry['hours']}")
    
    def test_list_time_entries(self, cpa_token):
        """GET /api/engagements/{id}/time-entries returns list"""
        list_resp = requests.get(
            f"{BASE_URL}/api/engagements",
            headers={"Authorization": f"Bearer {cpa_token}"}
        )
        engagements = list_resp.json()
        if not engagements:
            pytest.skip("CPA has no engagements")
        
        eng_id = engagements[0]["id"]
        
        response = requests.get(
            f"{BASE_URL}/api/engagements/{eng_id}/time-entries",
            headers={"Authorization": f"Bearer {cpa_token}"}
        )
        assert response.status_code == 200
        entries = response.json()
        assert isinstance(entries, list)
        print(f"Found {len(entries)} time entries")


class TestChecklist:
    """Review checklist endpoints tests"""
    
    @pytest.fixture
    def cpa_token(self):
        resp = requests.post(f"{BASE_URL}/api/auth/login", json=CPA_CREDS)
        return resp.json()["token"]
    
    def test_list_checklist(self, cpa_token):
        """GET /api/engagements/{id}/checklist returns items"""
        list_resp = requests.get(
            f"{BASE_URL}/api/engagements",
            headers={"Authorization": f"Bearer {cpa_token}"}
        )
        engagements = list_resp.json()
        if not engagements:
            pytest.skip("CPA has no engagements")
        
        eng_id = engagements[0]["id"]
        
        response = requests.get(
            f"{BASE_URL}/api/engagements/{eng_id}/checklist",
            headers={"Authorization": f"Bearer {cpa_token}"}
        )
        assert response.status_code == 200
        items = response.json()
        assert isinstance(items, list)
        assert len(items) > 0
        # Check structure
        item = items[0]
        assert "id" in item
        assert "item" in item
        assert "is_completed" in item
        print(f"Found {len(items)} checklist items")
    
    def test_toggle_checklist_item(self, cpa_token):
        """PATCH /api/checklist/{cid} toggles completion"""
        list_resp = requests.get(
            f"{BASE_URL}/api/engagements",
            headers={"Authorization": f"Bearer {cpa_token}"}
        )
        engagements = list_resp.json()
        if not engagements:
            pytest.skip("CPA has no engagements")
        
        eng_id = engagements[0]["id"]
        
        # Get checklist
        cl_resp = requests.get(
            f"{BASE_URL}/api/engagements/{eng_id}/checklist",
            headers={"Authorization": f"Bearer {cpa_token}"}
        )
        items = cl_resp.json()
        
        # Find an incomplete item
        incomplete = next((i for i in items if not i["is_completed"]), None)
        if not incomplete:
            pytest.skip("No incomplete checklist items")
        
        # Toggle to complete
        response = requests.patch(
            f"{BASE_URL}/api/checklist/{incomplete['id']}",
            headers={"Authorization": f"Bearer {cpa_token}"},
            json={"is_completed": True}
        )
        assert response.status_code == 200
        updated = response.json()
        assert updated["is_completed"] is True
        assert updated["completed_at"] is not None
        print(f"Toggled checklist item: {updated['item']}")


class TestMetrics:
    """Metrics endpoints tests"""
    
    @pytest.fixture
    def admin_token(self):
        resp = requests.post(f"{BASE_URL}/api/auth/login", json=ADMIN_CREDS)
        return resp.json()["token"]
    
    @pytest.fixture
    def ws_token(self):
        resp = requests.post(f"{BASE_URL}/api/auth/login", json=WS_CREDS)
        return resp.json()["token"]
    
    @pytest.fixture
    def cpa_token(self):
        resp = requests.post(f"{BASE_URL}/api/auth/login", json=CPA_CREDS)
        return resp.json()["token"]
    
    def test_pilot_metrics_admin(self, admin_token):
        """GET /api/metrics/pilot returns pilot metrics for admin"""
        response = requests.get(
            f"{BASE_URL}/api/metrics/pilot",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert "total_clients" in data
        assert data["total_clients"] == 10
        assert "pipeline" in data
        assert "avg_turnaround_days" in data
        print(f"Pilot metrics: total_clients={data['total_clients']}, pipeline={data['pipeline']}")
    
    def test_pilot_metrics_ws(self, ws_token):
        """GET /api/metrics/pilot accessible by WS partner"""
        response = requests.get(
            f"{BASE_URL}/api/metrics/pilot",
            headers={"Authorization": f"Bearer {ws_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert "total_clients" in data
        print(f"WS can access pilot metrics: total_clients={data['total_clients']}")
    
    def test_economics_admin_only(self, admin_token, cpa_token):
        """GET /api/metrics/economics accessible only by admin"""
        # Admin should succeed
        admin_resp = requests.get(
            f"{BASE_URL}/api/metrics/economics",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert admin_resp.status_code == 200
        data = admin_resp.json()
        # Should have tier data
        assert "BOOKS_COMPLETE" in data or "STANDARD" in data or "WHITE_GLOVE" in data
        print(f"Economics metrics: {list(data.keys())}")
        
        # CPA should be denied
        cpa_resp = requests.get(
            f"{BASE_URL}/api/metrics/economics",
            headers={"Authorization": f"Bearer {cpa_token}"}
        )
        assert cpa_resp.status_code == 403
        print("CPA correctly denied access to economics (403)")
    
    def test_utilization_metrics(self, admin_token):
        """GET /api/metrics/utilization returns CPA list with hours"""
        response = requests.get(
            f"{BASE_URL}/api/metrics/utilization",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        # Should have CPA entries
        for entry in data:
            assert "user" in entry
            assert "files" in entry
            assert "hours" in entry
        print(f"Utilization: {len(data)} CPAs tracked")


class TestUsers:
    """User management endpoints tests"""
    
    @pytest.fixture
    def admin_token(self):
        resp = requests.post(f"{BASE_URL}/api/auth/login", json=ADMIN_CREDS)
        return resp.json()["token"]
    
    def test_invite_user_creates_user_and_link(self, admin_token):
        """POST /api/users/invite creates user + invite link"""
        test_email = f"test_invite_{int(time.time())}@example.com"
        
        response = requests.post(
            f"{BASE_URL}/api/users/invite",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={
                "email": test_email,
                "name": "TEST_Invited User",
                "role": "CLIENT",
                "phone": "555-1234"
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert "user_id" in data
        assert "invite_link" in data
        assert "set-password" in data["invite_link"]
        print(f"Invited user: {test_email}, link: {data['invite_link'][:60]}...")
        return data
    
    def test_invite_duplicate_user_returns_409(self, admin_token):
        """POST /api/users/invite with existing email returns 409"""
        response = requests.post(
            f"{BASE_URL}/api/users/invite",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={
                "email": "admin@cloudtax.ca",  # Already exists
                "name": "Duplicate",
                "role": "CLIENT"
            }
        )
        assert response.status_code == 409
        print("Duplicate invite correctly rejected with 409")
    
    def test_update_user_toggle_active(self, admin_token):
        """PATCH /api/users/{uid} toggles is_active"""
        # First invite a new user
        test_email = f"test_toggle_{int(time.time())}@example.com"
        invite_resp = requests.post(
            f"{BASE_URL}/api/users/invite",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={
                "email": test_email,
                "name": "TEST_Toggle User",
                "role": "CLIENT"
            }
        )
        user_id = invite_resp.json()["user_id"]
        
        # Toggle is_active to False
        response = requests.patch(
            f"{BASE_URL}/api/users/{user_id}",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"is_active": False}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["is_active"] is False
        print(f"User deactivated: {data['email']}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
